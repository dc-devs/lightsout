import { expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { applyPlanningResult, selectPlanningWork } from '#src/plan/index.ts';
import { planningRoleProposalFixture } from '#tests/helpers/planningRoleProposalFixture.ts';
import { planningWorkflowFinding } from '#tests/helpers/planningWorkflowScenarios.ts';

const setup = async ({ variant }: { variant: string }) => {
	const scope = { kind: PlanningVocabulary.Scope.Selected, claimIds: ['required'], phaseIds: [], packageRoots: ['packages/engine'] };
	const fixture = await planningRoleProposalFixture({
		role: PlanningVocabulary.Role.DesignReview,
		scope: variant === 'all-roots' ? { ...scope, packageRoots: ['.'] } : scope,
	});
	const accepted = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });
	if (!accepted.accepted) throw new Error('Expected actual independent challenge');
	const snapshot = accepted.snapshot;
	const owner = snapshot.record.work.find((work) => work.id === fixture.work.id);
	const draft = snapshot.record.work.find((work) => work.role === PlanningVocabulary.Role.Draft);
	const receipt = snapshot.record.reviewReceipts.find((receipt) => receipt.workId === fixture.work.id);
	if (!owner || !draft || !receipt) throw new Error('Actual challenge and draft are required');
	snapshot.record.work = snapshot.record.work.filter((work) => work.status === PlanningVocabulary.WorkState.Complete || work.id === draft.id);
	draft.prerequisiteIds = [];
	draft.scope = structuredClone(scope);
	if (variant === 'child-root') draft.scope.packageRoots = ['packages/engine/src'];
	if (variant === 'outside-root') draft.scope.packageRoots = ['packages/other'];
	if (variant === 'outside-claim') draft.scope.claimIds = ['unreviewed'];
	if (variant === 'outside-phase') draft.scope.phaseIds = ['unreviewed-phase'];
	if (variant === 'whole') draft.scope = { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] };
	if (variant === 'stale-attempt') owner.currentAttemptId = 'later-attempt';
	if (variant === 'insufficient') receipt.coverage.outcome = PlanningVocabulary.Review.Insufficient;
	if (variant === 'interrupted') owner.status = PlanningVocabulary.WorkState.Interrupted;
	if (variant === 'assurance' || variant === 'other-stage-assurance')
		snapshot.record.work.push({
			...draft,
			id: 'assurance:pending',
			role: PlanningVocabulary.Role.DesignReview,
			stage: variant === 'assurance' ? draft.stage : PlanningVocabulary.Stage.Brainstorm,
		});
	if (['blocking', 'advisory', 'withdrawn', 'unrelated', 'own-failure'].includes(variant)) {
		const finding = planningWorkflowFinding({
			id: 'selection-gap',
			scope: variant === 'unrelated' ? { ...scope, claimIds: [], packageRoots: ['packages/other'] } : scope,
		});
		if (variant === 'advisory') finding.severity = PlanningVocabulary.Severity.Advisory;
		if (variant === 'withdrawn') finding.state = PlanningVocabulary.FindingState.Withdrawn;
		if (variant === 'own-failure') draft.failureIds = [finding.id];
		snapshot.record.findings.push(finding);
	}
	return { ...fixture, snapshot, draft };
};

test.each(['current', 'child-root', 'all-roots', 'advisory', 'unrelated', 'own-failure', 'other-stage-assurance'])(
	'selects a scoped draft with current sufficient challenge and no relevant blocker: %s',
	async (variant) => {
		const fixture = await setup({ variant });

		const result = selectPlanningWork({ snapshot: fixture.snapshot, stage: fixture.runtime.stage });

		expect(result.work.map((work) => work.id)).toStrictEqual([fixture.draft.id]);
	},
);

test.each(['outside-root', 'outside-claim', 'outside-phase', 'whole', 'stale-attempt', 'insufficient', 'interrupted', 'blocking', 'withdrawn', 'assurance'])(
	'withholds drafting when required coverage or assurance is absent: %s',
	async (variant) => {
		const fixture = await setup({ variant });

		const result = selectPlanningWork({ snapshot: fixture.snapshot, stage: fixture.runtime.stage });

		expect(result.work.some((work) => work.id === fixture.draft.id)).toBe(false);
	},
);
