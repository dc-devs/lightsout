import { basename } from 'node:path';
import type { GradedGap } from '#src/contracts/plan/grade/GradedGap.ts';
import type { PhaseWeight } from '#src/contracts/plan/grade/PhaseWeight.ts';
import type { StructuralFinding } from '#src/contracts/plan/grade/StructuralFinding.ts';
import type { GradeInputs } from '#src/contracts/plan/memory/GradeInputs.ts';
import type { GradeMemory } from '#src/contracts/plan/memory/GradeMemory.ts';
import type { GradeScope } from '#src/contracts/plan/memory/GradeScope.ts';
import { gapCheckLenses } from '#src/plan/common/constants/gapCheckLenses.ts';
import { weighSelection } from '#src/plan/common/grading/weighSelection.ts';
import { pendingFindingGaps } from '#src/plan/common/memory/pendingFindingGaps.ts';
import { revalidateResolutions } from '#src/plan/common/memory/revalidateResolutions.ts';
import { getPassCoverage } from '#src/plan/common/scope/getPassCoverage.ts';
import { getPhaseGraph } from '#src/plan/common/scope/getPhaseGraph.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { DetectionPass } from '#src/plan/common/types/DetectionPass.ts';
import type { PlanGradeParams } from '#src/plan/common/types/PlanGradeParams.ts';

interface Params {
	/** Everything this `plan grade` pass was asked for — read here for the working directory and the plan's name. */
	params: PlanGradeParams;
	pass: DetectionPass;
	/** The plan files this pass offers the readers, already narrowed to the decided scope. */
	selected: DeliverableFile[];
	scope: GradeScope;
	/** This pass's fingerprint. */
	inputs: GradeInputs;
	/** The memory as this pass found it. */
	memory: GradeMemory;
	/** The structural findings, already computed once for the invocation — counted in the progress line. */
	structural: StructuralFinding[];
	/** The pass timestamp, written onto every resolution this step reopens. */
	at: string;
	progress: (message: string) => void;
}

/**
 * The phase graph this pass records its readings against, or nothing when it
 * could not be built — which invalidates every plan file, the discipline every
 * reach rule in this path keeps. A single plan is one node joined to nothing: it
 * has no overview to declare an edge, and no sibling for an edge to reach.
 */
const phaseGraph = ({ pass }: { pass: DetectionPass }) => {
	if (pass.overviewText === undefined) {
		return new Map(pass.files.map((file) => [basename(file.path), new Set<string>()]));
	}

	const graph = getPhaseGraph({ files: pass.files, overviewText: pass.overviewText });

	return 'error' in graph ? undefined : graph.connections;
};

/**
 * Everything a pass settles before it spawns anything: what each selected plan
 * file weighs, the phase graph its readings are recorded against, what the
 * recorded coverage still covers, whether the whole-plan documentation checker
 * has anything to ask, which resolved findings the plan no longer supports, and
 * which findings are carried in for a judge.
 *
 * The coverage is read from the memory as the pass FOUND it, which is what makes
 * it the same answer `decideGradeScope` narrowed the readers by rather than a
 * second one computed here.
 *
 * Resolutions are revalidated here, with no agent, so a record whose citation the
 * plan no longer supports is reopened in time for this very pass to re-judge it.
 */
export const prepareGradePass = async ({
	params,
	pass,
	selected,
	scope,
	inputs,
	memory,
	structural,
	at,
	progress,
}: Params): Promise<{
	/** Every plan-file basename the deliverable holds now, in deliverable order. */
	planFiles: string[];
	weights: PhaseWeight[];
	/** The plan files a reader is spawned for, and the ones no reader reads. */
	heavy: DeliverableFile[];
	light: string[];
	connections?: Map<string, Set<string>>;
	found: ReturnType<typeof getPassCoverage>;
	/** Whether the whole-plan documentation checker runs — its own record being missing or stale, never how far this pass reached. */
	documentation: boolean;
	/** The memory with every unsupported resolution reopened. */
	memory: GradeMemory;
	/** The pending records this pass re-offers to the judge. */
	carried: GradedGap[];
}> => {
	const { cwd, name } = params;
	const planFiles = pass.files.map((file) => basename(file.path));
	const { weights, heavy, light } = weighSelection({ selected, config: pass.config });
	const connections = phaseGraph({ pass });
	const found = getPassCoverage({
		phaseFiles: planFiles,
		overviewText: pass.overviewText,
		inputs,
		coverage: memory.coverage,
		connections,
		baseline: memory.lastPass?.inputs,
	});
	// The checker keys on its OWN record rather than on how far this pass reached:
	// with no trailing whole-plan review left, a checker skipped for being on a
	// narrow pass would let an approval be granted having never run it.
	const documentation = found.docs === undefined;
	const revalidated = await revalidateResolutions({ cwd, files: pass.files, overviewText: pass.overviewText, memory, at });
	const carried = pendingFindingGaps({ memory: revalidated.memory });

	progress(
		`plan grade ${name}: ${scope} pass — ${structural.length} structural finding(s), gap-checking ${heavy.length} of ${pass.files.length} plan file(s) × ${gapCheckLenses.length} lens(es)${found.covered.length > 0 ? `, ${found.covered.length} plan file(s) already covered at their current text and read by nobody again` : ''}${light.length > 0 ? `, ${light.length} weighed light and read by nobody` : ''}${revalidated.reopened.length > 0 ? `, ${revalidated.reopened.length} resolved finding(s) reopened because the plan no longer states their answer` : ''}${carried.length > 0 ? `, ${carried.length} pending finding(s) carried in for a judge` : ''}`,
	);

	return { planFiles, weights, heavy, light, connections, found, documentation, memory: revalidated.memory, carried };
};
