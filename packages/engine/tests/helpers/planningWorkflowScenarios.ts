import type { PlanningFinding, PlanningRoleResult } from '#src/contracts/index.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

export const planningWorkflowFinding = ({ id, scope }: { id: string; scope: PlanningFinding['scope'] }): PlanningFinding => ({
	id,
	observationIds: [`observation:${id}`],
	scope,
	scenario: `Retry after ${id} loses the completed upload`,
	consequence: 'The user must upload completed content again',
	missingObligation: `Preserve retry identity for ${id}`,
	severity: PlanningVocabulary.Severity.Blocking,
	owner: PlanningVocabulary.Owner.Planner,
	state: PlanningVocabulary.FindingState.Open,
	resolutionClaimIds: [],
	resolutionArtifacts: [],
	verificationReceiptIds: [],
	citations: [],
});

export const planningRepairScenario = async ({ design = false } = {}) => {
	let findings = 0;
	const challengedRole = design ? PlanningVocabulary.Role.DesignReview : PlanningVocabulary.Role.ImplementationReview;
	const required = design ? 1 : 3;
	const snapshotsAtDraft: { blocking: string[]; reviewAttempts: string[] }[] = [];
	const fixture = await planningWorkflowFixture({
		respond: async ({ response, snapshot }) => {
			let proposed: PlanningRoleResult = response;
			if (response.role === challengedRole && 'coverage' in response && findings < required) {
				findings += 1;
				const assignment = snapshot.record.work.find((work) => work.id === response.workId);
				if (!assignment) throw new Error('Finding scenario requires an assignment');
				const scope = assignment.scope;
				proposed = {
					...response,
					findings: [planningWorkflowFinding({ id: `failure-${findings}`, scope })],
					coverage: { ...response.coverage, outcome: PlanningVocabulary.Review.Insufficient },
				};
			}
			if (response.role === PlanningVocabulary.Role.Draft)
				snapshotsAtDraft.push({
					blocking: snapshot.record.findings
						.filter((finding) => finding.state === PlanningVocabulary.FindingState.Open || finding.state === PlanningVocabulary.FindingState.Repairing)
						.map((finding) => finding.id),
					reviewAttempts: snapshot.record.reviewReceipts
						.filter((receipt) => receipt.role === PlanningVocabulary.Role.DesignReview)
						.map((receipt) => receipt.attemptId),
				});
			return {
				text: JSON.stringify(proposed),
				exitCode: 0,
				usage: { inputTokens: 50_000_000, outputTokens: 10_000_000, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 50_000 },
			};
		},
	});
	return { ...fixture, snapshotsAtDraft };
};

export const planningRecoveryScenario = async ({ timeout = false, malformed = false } = {}) => {
	let available = false;
	let timedOut = false;
	let malformedSent = false;
	const fixture = await planningWorkflowFixture({
		respond: async ({ response }) => {
			if (response.role === PlanningVocabulary.Role.Draft) {
				if (timeout && !timedOut) {
					timedOut = true;
					throw new Error('Harness timed out while drafting');
				}
				if (!available) return { text: 'Provider quota exhausted; resume after quota resets', exitCode: 1, rateLimited: true };
				if (malformed && !malformedSent) {
					malformedSent = true;
					return { text: '{"kind":"terminal","missing":"required fields"}', exitCode: 0 };
				}
			}
			return response;
		},
	});
	return {
		...fixture,
		makeAvailable: () => {
			available = true;
		},
	};
};
