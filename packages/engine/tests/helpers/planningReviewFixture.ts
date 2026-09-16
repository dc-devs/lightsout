import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningClaim, type PlanningRoleResult, type PlanningScope, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import {
	applyPlanningResult,
	claimPlanningAttempt,
	commitPlanningSnapshot,
	evaluatePlanningReadiness,
	invalidatePlanningEvidence,
	invokePlanningRole,
	planReviewCoverage,
	readPlanningSnapshot,
	renderPlanningSections,
	reviewPlanningIntegration,
	runPlanning,
	validatePlanningArtifacts,
} from '#src/plan/index.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';
import { planningWorkflowResponse } from '#tests/helpers/planningWorkflowResponse.ts';

interface Options {
	name?: string;
	stage?: PlanningWork['stage'];
	sourceText?: string;
	respond?: (params: { response: PlanningRoleResult; snapshot: NonNullable<Awaited<ReturnType<typeof readPlanningSnapshot>>> }) => PlanningRoleResult;
}

/** Actual role invocations and accepted immutable proofs; the only model substitute is a controlled semantic response. */
export const planningReviewFixture = async ({ stage = PlanningVocabulary.Stage.Implementation, sourceText, respond, name }: Options = {}) => {
	const fixture = await planningWorkflowFixture({ stage, name });
	const current = async () => {
		const snapshot = await readPlanningSnapshot(fixture);
		if (!snapshot) throw new Error('Review fixture lost its canonical generation');
		return snapshot;
	};
	const answer = ({ response, snapshot }: Parameters<NonNullable<Options['respond']>>[0]): PlanningRoleResult => {
		if (
			response.role === PlanningVocabulary.Role.Architect &&
			response.kind === PlanningVocabulary.ResultKind.Terminal &&
			stage === PlanningVocabulary.Stage.Implementation
		) {
			const origin = snapshot.record.sources[0];
			const acceptance: PlanningClaim = {
				id: 'retry-acceptance',
				kind: PlanningVocabulary.ClaimKind.Acceptance,
				text: 'Verify the approved retry behavior.',
				explanation: 'Exercise completion preservation after retry failure.',
				contentRevision: 1,
				origin,
				owner: PlanningVocabulary.Owner.Planner,
				state: PlanningVocabulary.ClaimState.Settled,
				dependencies: ['required', 'upload-architecture'],
				scope: fixture.scope,
				acceptance: {
					kind: PlanningVocabulary.Acceptance.Test,
					criterion: 'A failed retry retains completed uploads.',
					testFile: 'src/retryUpload.unit.test.ts',
					testName: 'retains completed uploads after retry failure',
					gate: 'test',
				},
			};
			response = {
				...response,
				claims: [...response.claims, acceptance],
				artifactLayouts: response.artifactLayouts?.map((layout) => ({ ...layout, claimIds: [...layout.claimIds, acceptance.id] })),
			};
		}
		if (response.role === PlanningVocabulary.Role.Draft && response.kind === PlanningVocabulary.ResultKind.Terminal) {
			const content =
				'# Retry implementation\n\n## Context\n\nPreserve completed uploads and reuse their retry identity.\n\n## Prerequisites\n\nNone.\n\n## Files to Create\n\n### `src/retryUpload.ts`\n\nRead completion before a retry; failed retries retain completed data.\n\n### `src/retryUpload.unit.test.ts`\n\nExercise the exact approved acceptance behavior.\n\n## Scope Boundaries\n\nPreserve the upload contract and failure ordering.\n\n## Verification\n\n- `true` — fixture verification.\n\n## What Next Plan Expects\n\nNone.\n';
			response = { ...response, artifactEdits: response.artifactEdits.map((edit) => ({ ...edit, content })) };
		}
		if (response.role === PlanningVocabulary.Role.Repair && response.kind === PlanningVocabulary.ResultKind.Terminal)
			response = {
				...response,
				artifactEdits: response.artifactEdits.map((edit) => ({
					...edit,
					content: (snapshot.artifacts.get(edit.path) ?? '').replace(
						'\n## Context\n',
						`\n## Context\n\nResolved: ${snapshot.record.findings
							.filter((finding) => finding.state === PlanningVocabulary.FindingState.Open)
							.map((finding) => finding.missingObligation)
							.join('; ')}\n`,
					),
				})),
			};
		if (response.role === PlanningVocabulary.Role.Adjudicate && response.kind === PlanningVocabulary.ResultKind.Terminal) {
			const request = [...snapshot.artifacts]
				.filter(([path]) => path.startsWith('planning-adjudication-requests/'))
				.map(([, text]) => JSON.parse(text))
				.find((item) => item.workId === response.workId)?.request;
			if (!request) throw new Error('Adjudication fixture requires an actual recorded dispute');
			response = {
				...response,
				dispositions: [
					{
						findingIds: request.findingIds,
						outcome: PlanningVocabulary.Disposition.Repair,
						reason: 'The original preservation requirement applies to both observations.',
						citations: request.citations,
					},
				],
			};
		}
		if ('coverage' in response)
			response = {
				...response,
				coverage: {
					...response.coverage,
					sourceDigests: [...new Set(snapshot.record.sources.map((source) => source.sha256))],
					artifactPaths: snapshot.record.artifacts.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data).map((artifact) => artifact.path),
					adequacy:
						'Read the complete original source and rejected alternatives; traced every assigned behavior, interface, failure scenario, and exact acceptance obligation, including omissions beyond the inventory.',
				},
			};
		return respond ? respond({ response, snapshot }) : response;
	};
	fixture.runtime.driver = {
		name: fixture.runtime.driver.name,
		invoke: async (invocation) => {
			fixture.calls.push(invocation);
			const snapshot = await current();
			const response = answer({ response: planningWorkflowResponse({ invocation, snapshot }), snapshot });
			return { exitCode: 0, text: JSON.stringify(response) };
		},
	};
	fixture.runtime.services = {
		...fixture.runtime.services,
		render: renderPlanningSections,
		validate: validatePlanningArtifacts,
		invalidate: (params) => ({ ...invalidatePlanningEvidence(params), ...(!params.delta ? { work: planReviewCoverage({ snapshot: params.snapshot }) } : {}) }),
		evaluate: evaluatePlanningReadiness,
		integration: reviewPlanningIntegration,
		integrationContext: async ({ snapshot }) => ({
			digest: evaluatePlanningReadiness({ snapshot, stage, structural: [], dependenciesCurrent: true }).inputDigest,
			content: canonicalJson({
				value: { coverage: snapshot.record.reviewReceipts.filter((receipt) => receipt.role !== PlanningVocabulary.Role.IntegrationReview) },
			}),
			dependencies: [],
		}),
	};
	if (sourceText !== undefined) {
		const origin = { ...fixture.origin, text: sourceText, sha256: sha256({ content: sourceText }) };
		fixture.input.sources = [origin];
		fixture.input.claims = fixture.input.claims.map((claim) => ({ ...claim, text: sourceText, origin }));
		fixture.input.confirmations = fixture.input.confirmations.map((confirmation) => ({
			...confirmation,
			messageText: sourceText,
			approvedDigest: origin.sha256,
		}));
	}
	let sequence = 0;
	const accept = async ({ role, scope = fixture.scope, propose }: { role: PlanningWork['role']; scope?: PlanningScope; propose?: Options['respond'] }) => {
		const before = await current();
		const id = `independent-review:${sequence++}`;
		const work: PlanningWork = {
			id,
			role,
			stage,
			scope,
			prerequisiteIds: [],
			inputDigest: sha256({ content: canonicalJson({ value: { id, role, scope } }) }),
			status: PlanningVocabulary.WorkState.Pending,
			attemptSequence: 0,
			failureIds: [],
			diagnosisIds: [],
			assignment: 'Independently inspect the complete assigned original behavior and concrete repair; retain all persistent observations.',
		};
		const saved = await commitPlanningSnapshot({
			...fixture,
			expectedRevision: before.record.revision,
			parentDigest: before.digest,
			record: { ...before.record, revision: before.record.revision + 1, parentDigest: before.digest, work: [...before.record.work, work] },
			artifacts: before.artifacts,
		});
		if (!saved.committed) throw new Error('Review fixture lost work creation');
		const priorDriver = fixture.runtime.driver;
		if (propose)
			fixture.runtime.driver = {
				...priorDriver,
				invoke: async (invocation) => {
					fixture.calls.push(invocation);
					const snapshot = await current();
					const response = propose({ response: answer({ response: planningWorkflowResponse({ invocation, snapshot }), snapshot }), snapshot });
					return { exitCode: 0, text: JSON.stringify(response) };
				},
			};
		try {
			const claim = await claimPlanningAttempt({ runtime: fixture.runtime, workId: id, expectedInputDigest: work.inputDigest });
			if (!claim.claimed) throw new Error('Review fixture could not claim work');
			const claimed = claim.snapshot.record.work.find((item) => item.id === id);
			if (!claimed) throw new Error('Review fixture lost claimed work');
			const result = await invokePlanningRole({ runtime: fixture.runtime, snapshot: claim.snapshot, work: claimed });
			const accepted = await applyPlanningResult({ runtime: fixture.runtime, result });
			if (!accepted.accepted) throw new Error(`Review fixture rejected actual invocation: ${accepted.reason}`);
			return accepted.snapshot;
		} finally {
			fixture.runtime.driver = priorDriver;
		}
	};
	const run = async () => {
		await fixture.capture();
		return runPlanning({ runtime: fixture.runtime });
	};
	return { ...fixture, current, run, accept };
};
