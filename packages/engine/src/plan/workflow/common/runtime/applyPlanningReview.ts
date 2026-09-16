import { z } from 'zod';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningAdjudicationRequest, type PlanningRecord, type PlanningRoleResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { validatePlanningUnknownAssessments } from '#src/plan/workflow/common/review/validatePlanningUnknownAssessments.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { validatePlanningCitations } from '#src/plan/workflow/common/runtime/validatePlanningCitations.ts';
import type { PlanningInvocation } from '#src/plan/workflow/common/types/invocation/PlanningInvocation.ts';
import { PlanningAssuranceObligation } from '#src/plan/workflow/common/types/PlanningAssuranceObligation.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import { PlanningSettlement } from '#src/plan/workflow/common/types/PlanningSettlement.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	runtime: PlanningRuntime;
	previous: PlanningSnapshot;
	record: PlanningRecord;
	result: PlanningRoleResult;
	invocation: PlanningInvocation;
	artifacts: Map<string, string>;
}

type Validate = (params: { citations: Parameters<typeof validatePlanningCitations>[0]['citations'] }) => Promise<void>;

const validateAssignedDispute = ({ previous, result }: { previous: PlanningSnapshot; result: PlanningRoleResult }) => {
	if ('dispositions' in result) {
		const request = z
			.object({ workId: z.string(), request: PlanningAdjudicationRequest })
			.strict()
			.nullable()
			.parse(JSON.parse(previous.artifacts.get(`planning-adjudication-requests/${sha256({ content: result.workId })}.json`) ?? 'null'));
		const assigned = request?.request.findingIds;
		const disposed = result.dispositions.flatMap((disposition) => disposition.findingIds);
		if (
			!assigned ||
			assigned.some((id) => !disposed.includes(id)) ||
			disposed.some((id) => !assigned.includes(id)) ||
			new Set(disposed).size !== disposed.length
		)
			throw new Error('Adjudication must resolve exactly its explicit assigned dispute');
	}
};

const applyResolutions = async ({
	record,
	result,
	previous,
	invocation,
	artifacts,
	validate,
}: Pick<Params, 'record' | 'result' | 'previous' | 'invocation' | 'artifacts'> & { validate: Validate }): Promise<void> => {
	if ('resolutions' in result)
		for (const resolution of result.resolutions) {
			const finding = record.findings.find((item) => item.id === resolution.findingId);
			if (!finding || finding.state === PlanningVocabulary.FindingState.Withdrawn) throw new Error('Repair references an unavailable finding');
			if (resolution.claimIds.length + resolution.artifacts.length === 0) throw new Error('A repair must identify concrete changed obligations or artifacts');
			if (
				resolution.claimIds.some((id) => !record.claims.some((claim) => claim.id === id)) ||
				resolution.artifacts.some((path) => !record.artifacts.some((artifact) => artifact.path === path))
			)
				throw new Error('Repair references missing outputs');
			finding.state = PlanningVocabulary.FindingState.Repairing;
			finding.resolutionClaimIds = resolution.claimIds;
			finding.resolutionArtifacts = resolution.artifacts;
			finding.proposedResolution = resolution.explanation;
			for (const receipt of record.reviewReceipts.filter((receipt) => receipt.findingIds.includes(finding.id))) {
				const reviewer = record.work.find(
					(work) => work.id === receipt.workId && work.currentAttemptId === receipt.attemptId && work.status === PlanningVocabulary.WorkState.Complete,
				);
				if (!reviewer) continue;
				reviewer.status = PlanningVocabulary.WorkState.Pending;
				reviewer.currentAttemptId = undefined;
				reviewer.resultReceiptId = undefined;
			}
		}
	validateAssignedDispute({ previous, result });
	if ('dispositions' in result)
		for (const disposition of result.dispositions) {
			await validate({ citations: disposition.citations });
			if (disposition.outcome === PlanningVocabulary.Disposition.Withdraw && disposition.citations.length === 0)
				throw new Error('Withdrawal requires evidence that the report was mistaken');
			for (const id of disposition.findingIds) {
				const finding = record.findings.find((item) => item.id === id);
				if (!finding) throw new Error('Adjudication references a missing finding');
				if (finding.owner === PlanningVocabulary.Owner.User && disposition.outcome === PlanningVocabulary.Disposition.Repair)
					throw new Error('Adjudication cannot answer a user-owned conflict as an ordinary technical repair');
				finding.proposedResolution = disposition.reason;
				if (disposition.outcome === PlanningVocabulary.Disposition.Withdraw) {
					finding.state = PlanningVocabulary.FindingState.Withdrawn;
					finding.citations = [...finding.citations, ...disposition.citations];
					attachPlanningData({
						record,
						artifacts,
						path: `planning-settlements/${sha256({ content: `${result.attemptId}:${finding.id}` })}.json`,
						value: PlanningSettlement.parse({
							format: 'planning-settlement-v1',
							findingId: finding.id,
							workId: result.workId,
							attemptId: result.attemptId,
							resultReceiptId: `result:${result.attemptId}`,
							invocationId: invocation.id,
							reason: disposition.reason,
							citations: disposition.citations,
							dependencies: invocation.dependencies,
						}),
					});
				}
				if (disposition.outcome === PlanningVocabulary.Disposition.Escalate) finding.owner = PlanningVocabulary.Owner.User;
			}
		}
};

const applyAssurance = async ({
	previous,
	record,
	result,
	invocation,
	artifacts,
	validate,
}: Omit<Params, 'runtime'> & { validate: Validate }): Promise<void> => {
	if (!('coverage' in result)) return;
	if (result.workId.startsWith('assurance:')) {
		const key = result.workId.slice('assurance:'.length);
		const obligation = PlanningAssuranceObligation.nullable().parse(JSON.parse(previous.artifacts.get(`planning-assurance-obligations/${key}.json`) ?? 'null'));
		const assessments = 'unknownAssessments' in result ? (result.unknownAssessments ?? []) : [];
		if (!obligation) throw new Error('Unknown assessment lacks its recorded obligation');
		const assignedIds = new Set([
			...obligation.dependencyIds,
			...invocation.dependencies.filter((item) => item.kind === PlanningVocabulary.Dependency.Unknown).map((item) => item.id),
		]);
		if (!invocation.assuranceBasis) throw new Error('Unknown assessment lacks a current invocation basis');
		const blockedReasons = await validatePlanningUnknownAssessments({
			assignedIds,
			claimIds: new Set(record.claims.map((claim) => claim.id)),
			evidence: record.evidence,
			assessments,
			validateCitations: validate,
		});
		attachPlanningData({
			record,
			artifacts,
			path: `planning-assurances/${key}/${result.attemptId}.json`,
			value: { workId: result.workId, attemptId: result.attemptId, basis: invocation.assuranceBasis, cycleId: obligation.cycleId, assessments, blockedReasons },
		});
	}
};

/** Verify repairs only through a distinct current reviewer with actual quoted evidence. */
export const applyPlanningReview = async ({ runtime, previous, record, result, invocation, artifacts }: Params): Promise<void> => {
	const validate = ({ citations }: { citations: Parameters<typeof validatePlanningCitations>[0]['citations'] }) =>
		validatePlanningCitations({ cwd: runtime.cwd, snapshot: previous, dependencies: invocation.dependencies, citations });
	if ('findings' in result) for (const finding of result.findings) await validate({ citations: finding.citations });
	await applyResolutions({ record, result, previous, invocation, artifacts, validate });
	if (!('coverage' in result)) return;
	await applyAssurance({ previous, record, result, invocation, artifacts, validate });

	const authors = record.work.filter(
		(work) =>
			work.status === PlanningVocabulary.WorkState.Complete &&
			work.currentAttemptId &&
			[PlanningVocabulary.Role.Architect, PlanningVocabulary.Role.Draft, PlanningVocabulary.Role.Repair].some((role) => role === work.role),
	);
	const authorAttemptIds = [...new Set(authors.flatMap((work) => (work.currentAttemptId ? [work.currentAttemptId] : [])))];
	if (authorAttemptIds.length === 0 || authorAttemptIds.includes(result.attemptId))
		throw new Error('Independent review requires distinct actual author attempts');
	const id = `review:${result.attemptId}`;
	for (const verification of result.verifiedFindings) {
		const finding = record.findings.find((item) => item.id === verification.findingId);
		if (!finding || (finding.state !== PlanningVocabulary.FindingState.Repairing && finding.state !== PlanningVocabulary.FindingState.Verified))
			throw new Error('Review cannot verify an unrepaired finding');
		if (finding.id.startsWith('structural:')) {
			const remaining = await runtime.services.validate({ runtime, snapshot: previous, artifacts: previous.artifacts });
			if (remaining.some((item) => item.issue === finding.scenario && item.fix === finding.missingObligation))
				throw new Error('A deterministic defect cannot be verified while its check still fails');
		}
		await validate({ citations: verification.citations });
		finding.state = PlanningVocabulary.FindingState.Verified;
		finding.verificationReceiptIds = [...finding.verificationReceiptIds, id];
	}
	record.reviewReceipts.push({
		id,
		workId: result.workId,
		attemptId: result.attemptId,
		authorAttemptIds,
		role: result.role,
		inputDigest: result.inputDigest,
		coverage: result.coverage,
		dependencies: invocation.dependencies,
		issuer: { agent: runtime.driver.name, invocationId: invocation.id },
		findingIds: result.findings.map((finding) => finding.id),
		verifiedFindings: result.verifiedFindings,
		completedAt: new Date(runtime.clock?.() ?? Date.now()).toISOString(),
		...(result.role === PlanningVocabulary.Role.IntegrationReview
			? { integrationDigest: (await runtime.services.integrationContext?.({ runtime, snapshot: previous }))?.digest }
			: {}),
	});
};
