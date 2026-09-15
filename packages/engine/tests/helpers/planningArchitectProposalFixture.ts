import { PlanningVocabulary } from '#src/contracts/index.ts';
import { applyPlanningResult, claimPlanningAttempt, invokePlanningRole } from '#src/plan/index.ts';
import { planningClaimedWorkflowFixture } from '#tests/helpers/planningClaimedWorkflowFixture.ts';

/** Reach architecture through a real accepted investigation and a separately claimed invocation. */
export const planningArchitectProposalFixture = async (options: Parameters<typeof planningClaimedWorkflowFixture>[0] = {}) => {
	const fixture = await planningClaimedWorkflowFixture(options);
	const investigation = await invokePlanningRole({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work });
	const accepted = await applyPlanningResult({ runtime: fixture.runtime, result: investigation });
	if (!accepted.accepted) throw new Error('Fixture investigation was rejected');
	const selected = accepted.snapshot.record.work.find((work) => work.role === PlanningVocabulary.Role.Architect);
	if (!selected) throw new Error('Fixture architect is absent');
	const claimed = await claimPlanningAttempt({ runtime: fixture.runtime, workId: selected.id, expectedInputDigest: selected.inputDigest });
	if (!claimed.claimed) throw new Error('Fixture architect lost its claim');
	const work = claimed.snapshot.record.work.find((item) => item.id === selected.id);
	if (!work) throw new Error('Claimed architect is absent');
	const result = await invokePlanningRole({ runtime: fixture.runtime, snapshot: claimed.snapshot, work });
	if (result.kind !== PlanningVocabulary.ResultKind.Terminal || result.role !== PlanningVocabulary.Role.Architect)
		throw new Error('Expected architecture proposal');
	return { ...fixture, work, result };
};
