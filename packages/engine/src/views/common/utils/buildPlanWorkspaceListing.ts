import { type PlanGrade, PlanStage, type PlanWorkspaceListing, type RunListing, RunStatus } from '#src/contracts/index.ts';
import type { PlanWorkspaceFiles } from '#src/views/common/types/PlanWorkspaceFiles.ts';

/**
 * How far the workspace got, from the files it holds and the runs that named
 * them.
 *
 * Each step overwrites the one before, so the last condition that holds is the
 * answer — which is what makes the order the definition rather than a chain of
 * conditions a reader has to unpick.
 *
 * `Implemented` needs a run that PASSED. A plan mid-implementation, or one whose
 * run failed, keeps the stage its files give it — which is the true answer, and
 * what keeps it counted among the open plans.
 */
const derivePlanStage = ({ files, hasGrade, runs }: { files: PlanWorkspaceFiles; hasGrade: boolean; runs: RunListing[] }) => {
	let stage: PlanStage = PlanStage.Started;

	if (files.notesFile !== undefined) {
		stage = PlanStage.NotesOnly;
	}

	if (files.planFile !== undefined) {
		stage = PlanStage.Drafted;
	}

	if (hasGrade) {
		stage = PlanStage.Graded;
	}

	if (runs.some((run) => run.status === RunStatus.Passed)) {
		stage = PlanStage.Implemented;
	}

	return stage;
};

interface Params {
	name: string;
	files: PlanWorkspaceFiles;
	/** `grade.json` is on disk — which is what makes a workspace graded, whether or not the file parses. */
	hasGrade: boolean;
	/** The grade that file carried, absent when it would not parse. */
	grade?: PlanGrade;
	/** The runs already matched to this workspace. */
	runs: RunListing[];
}

/**
 * One row of the plans list, from a walk that is already done.
 *
 * Both readers build their row here rather than each deriving a stage: the list
 * page and the detail page have to agree about how far a plan got, and two
 * derivations would eventually disagree.
 */
export const buildPlanWorkspaceListing = ({ name, files, hasGrade, grade, runs }: Params): PlanWorkspaceListing => ({
	name,
	stage: derivePlanStage({ files, hasGrade, runs }),
	grade,
	hasNotes: files.notesFile !== undefined,
	hasPlanFile: files.planFile !== undefined,
	implementedFiles: files.implementedFiles,
	// A phased plan is the one whose drafted file is an overview; `plan.md` is a
	// single plan however many stray phase files sit beside it.
	phased: files.planFile?.name === 'overview.md',
	phaseCount: files.phaseFiles.length,
	updatedAt: files.updatedAt,
	runCount: runs.length,
});
