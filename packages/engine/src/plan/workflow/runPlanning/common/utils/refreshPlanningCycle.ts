import { messageOf } from '#src/common/utils/messageOf.ts';
import { PlanningReadiness, type PlanningRunResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { pendingPlanningQuestion } from '#src/plan/workflow/common/questions/pendingPlanningQuestion.ts';
import { planningIntegrationBasis } from '#src/plan/workflow/common/review/planningIntegrationBasis.ts';
import { commitPlanningStandards } from '#src/plan/workflow/common/runtime/commitPlanningStandards.ts';
import { recoverPlanningResult } from '#src/plan/workflow/common/runtime/recoverPlanningResult.ts';
import { refreshPlanningAssurance } from '#src/plan/workflow/common/runtime/refreshPlanningAssurance.ts';
import { refreshPlanningWork } from '#src/plan/workflow/common/runtime/refreshPlanningWork.ts';
import { syncPlanningStructure } from '#src/plan/workflow/common/runtime/syncPlanningStructure.ts';
import { PlanningAssuranceObligation } from '#src/plan/workflow/common/types/PlanningAssuranceObligation.ts';
import type { PlanningCycle } from '#src/plan/workflow/common/types/PlanningCycle.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
	cycleId: string;
}
const blocked = ({ runtime, snapshot, cause }: { runtime: PlanningRuntime; snapshot: PlanningSnapshot; cause: string }): PlanningRunResult => ({
	status: PlanningVocabulary.Status.ExternallyBlocked,
	name: runtime.name,
	generation: snapshot.digest,
	cause,
	continuation: runtime.name,
});

const evaluateCycle = async ({
	runtime,
	snapshot,
	cycleId,
}: {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
	cycleId: string;
}): Promise<PlanningCycle> => {
	const cycles = [...snapshot.artifacts]
		.filter(([path]) => path.startsWith('planning-assurance-obligations/'))
		.map(([, text]) => PlanningAssuranceObligation.parse(JSON.parse(text)));
	if (!cycles.some((cycle) => cycle.cycleId === cycleId)) {
		const activeCycle = cycles.find((cycle) =>
			snapshot.record.work.some((work) => work.id === cycle.workId && work.stage === runtime.stage && work.status !== PlanningVocabulary.WorkState.Complete),
		);
		if (activeCycle) cycleId = activeCycle.cycleId;
	}
	const structural = await runtime.services.validate({ runtime, snapshot, artifacts: snapshot.artifacts });
	snapshot = await syncPlanningStructure({ runtime, structural, snapshot });
	const assured = await refreshPlanningAssurance({ runtime, cycleId, snapshot });
	snapshot = assured.snapshot;
	assured.assurance.semanticDigest = planningIntegrationBasis({ snapshot });
	let cycle: PlanningCycle = { snapshot, cycleId, structural: [], recovered: false };
	if (assured.assurance.blockedReasons.length > 0) {
		cycle.result = blocked({ runtime, snapshot, cause: assured.assurance.blockedReasons.join('\n') });
	} else {
		const readiness = PlanningReadiness.parse(
			runtime.services.evaluate({
				snapshot,
				structural,
				dependenciesCurrent: assured.assurance.pendingWorkIds.length === 0,
				assurance: assured.assurance,
				stage: runtime.stage,
			}),
		);
		cycle = { snapshot, cycleId, structural, readiness, assurance: assured.assurance, recovered: false };
	}
	return cycle;
};

/** Refresh actual evidence and required questions before asking which obligation should run next. */
export const refreshPlanningCycle = async ({ runtime, snapshot, cycleId }: Params): Promise<PlanningCycle> => {
	let cycle: PlanningCycle = { snapshot, cycleId, structural: [], recovered: false };
	try {
		const committed = await commitPlanningStandards({ runtime });
		snapshot = await refreshPlanningWork({ runtime, standards: committed.standards, snapshot: committed.snapshot });
		cycle.snapshot = snapshot;
	} catch (error) {
		cycle.result = blocked({ runtime, snapshot, cause: `Required planning inputs are unavailable: ${messageOf({ error })}` });
	}
	if (!cycle.result) {
		try {
			const recovered = await recoverPlanningResult({ runtime, snapshot });
			if (recovered) cycle = { snapshot: recovered, cycleId, structural: [], recovered: true };
		} catch (error) {
			cycle.result = blocked({ runtime, snapshot, cause: `Planning recovery is unavailable: ${messageOf({ error })}` });
		}
	}
	if (!cycle.result && !cycle.recovered) {
		const question = await pendingPlanningQuestion({ runtime, snapshot, includeAlignment: false });
		if (question) cycle.result = question;
		else {
			cycle = await evaluateCycle({ runtime, snapshot, cycleId });
			// Required unavailable information and newly scheduled assurance must precede final design approval.
			if (!cycle.result) cycle.result = await pendingPlanningQuestion({ runtime, snapshot: cycle.snapshot });
			if (!cycle.result)
				cycle.result = await runtime.services.proposal?.({
					runtime,
					snapshot: cycle.snapshot,
					ready: cycle.readiness?.ready ?? false,
					assurance: cycle.assurance,
				});
		}
	}
	return cycle;
};
