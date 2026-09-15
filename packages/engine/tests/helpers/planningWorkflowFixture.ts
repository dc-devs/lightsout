import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningReadiness, type PlanningRoleResult, PlanningVocabulary } from '#src/contracts/index.ts';
import type { DriverInvocation, DriverResult } from '#src/drivers/index.ts';
import {
	capturePlanningInput,
	invokePlanningRole,
	PlanningLease,
	PlanningMode,
	type PlanningRuntime,
	type PlanningSnapshot,
	readPlanningSnapshot,
} from '#src/plan/index.ts';
import { planningStoreFixture } from '#tests/helpers/planningStoreFixture.ts';
import { planningWorkflowResponse } from '#tests/helpers/planningWorkflowResponse.ts';

interface Options {
	stage?: PlanningRuntime['stage'];
	respond?: (params: {
		invocation: DriverInvocation;
		snapshot: PlanningSnapshot;
		response: PlanningRoleResult;
		call: number;
	}) => Promise<DriverResult | PlanningRoleResult>;
}

const evaluate = ({
	snapshot,
	stage,
	dependenciesCurrent,
}: {
	snapshot: PlanningSnapshot;
	stage: PlanningRuntime['stage'];
	dependenciesCurrent: boolean;
}): PlanningReadiness => {
	const record = snapshot.record;
	const pending = record.work.filter((work) => work.stage === stage && work.status !== PlanningVocabulary.WorkState.Complete);
	const blockers = record.findings.filter(
		(finding) =>
			finding.severity === PlanningVocabulary.Severity.Blocking &&
			finding.state !== PlanningVocabulary.FindingState.Verified &&
			finding.state !== PlanningVocabulary.FindingState.Withdrawn,
	);
	const questions = record.claims.filter((claim) => claim.owner === PlanningVocabulary.Owner.User && claim.state === PlanningVocabulary.ClaimState.Unresolved);
	const target = stage === PlanningVocabulary.Stage.Brainstorm ? PlanningVocabulary.Target.Alignment : PlanningVocabulary.Target.Implementation;
	const finalRole = stage === PlanningVocabulary.Stage.Brainstorm ? PlanningVocabulary.Role.DesignReview : PlanningVocabulary.Role.IntegrationReview;
	const review = [...record.reviewReceipts]
		.reverse()
		.find(
			(receipt) =>
				receipt.role === finalRole &&
				receipt.coverage.outcome === PlanningVocabulary.Review.Adequate &&
				record.work.some(
					(work) => work.id === receipt.workId && work.status === PlanningVocabulary.WorkState.Complete && work.currentAttemptId === receipt.attemptId,
				),
		);
	const ready = dependenciesCurrent && pending.length === 0 && blockers.length === 0 && questions.length === 0 && review !== undefined;
	return {
		target,
		ready,
		generation: snapshot.digest,
		inputDigest: sha256({ content: canonicalJson({ value: record.sources }) }),
		structuralFailures: [],
		uncoveredClaimIds: [],
		openBlockerIds: blockers.map((finding) => finding.id),
		unresolvedQuestionIds: questions.map((claim) => claim.id),
		...(target === PlanningVocabulary.Target.Implementation && review ? { integrationReceiptId: review.id } : {}),
		...(ready ? {} : { missingReason: 'Expected work, questions or independent coverage remain unresolved' }),
	};
};

/** Deterministic service predicate for scheduler tests; production readiness is exercised in its own phase. */
export const planningWorkflowFixture = async ({ stage = PlanningVocabulary.Stage.Implementation, respond }: Options = {}) => {
	const fixture = await planningStoreFixture();
	await writeFile(join(fixture.cwd, 'package.json'), '{"name":"workflow-test"}');
	const calls: DriverInvocation[] = [];
	let semanticInvocation: DriverInvocation | undefined;
	const runtime: PlanningRuntime = {
		cwd: fixture.cwd,
		name: fixture.name,
		stage,
		mode: PlanningMode.Automatic,
		config: { gates: { check: 'true', test: 'true', 'test-coverage': false }, 'standards-packs': false },
		model: 'configured-model',
		effort: 'high',
		permissions: 'full-access',
		standards: '',
		lease: new PlanningLease({ cwd: fixture.cwd, name: fixture.name }),
		driver: {
			name: 'claude-code',
			invoke: async (invocation) => {
				calls.push(invocation);
				const snapshot = await readPlanningSnapshot({ cwd: fixture.cwd, name: fixture.name });
				if (!snapshot) throw new Error('Provider was called before canonical input existed');
				if (invocation.prompt.trimStart().startsWith('{')) semanticInvocation = invocation;
				if (!semanticInvocation) throw new Error('Re-emission requires an original semantic invocation');
				const response = planningWorkflowResponse({ invocation: semanticInvocation, snapshot });
				const result = respond ? await respond({ invocation, snapshot, response, call: calls.length }) : response;
				return 'exitCode' in result ? result : { text: JSON.stringify(result), exitCode: 0 };
			},
		},
		services: {
			integrationContext: async ({ snapshot }) => {
				const record = snapshot.record;
				const content = canonicalJson({
					value: {
						claims: record.claims,
						artifacts: record.artifacts.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data),
						standards: record.standards,
						reviews: record.reviewReceipts.filter((receipt) => receipt.role !== PlanningVocabulary.Role.IntegrationReview),
						findings: record.findings.map(({ verificationReceiptIds: _receipts, state, ...meaning }) => ({
							...meaning,
							state: state === PlanningVocabulary.FindingState.Verified ? PlanningVocabulary.FindingState.Repairing : state,
						})),
					},
				});
				return { digest: sha256({ content }), content, dependencies: [] };
			},
			draft: invokePlanningRole,
			integration: async ({ runtime, snapshot }) => {
				const work = snapshot.record.work.find(
					(item) => item.role === PlanningVocabulary.Role.IntegrationReview && item.status === PlanningVocabulary.WorkState.Running,
				);
				if (!work) throw new Error('Integration requires a claimed assignment');
				return invokePlanningRole({ runtime, snapshot, work });
			},
			validate: async () => [],
			invalidate: () => ({ workIds: [], receiptIds: [], reason: 'Fixture selects its invalidation scenario explicitly' }),
			evaluate,
		},
	};
	const input = { stage, sources: fixture.record.sources, claims: fixture.record.claims, confirmations: fixture.record.confirmations };
	return { ...fixture, runtime, input, calls, respond, capture: () => capturePlanningInput({ runtime, input }) };
};
