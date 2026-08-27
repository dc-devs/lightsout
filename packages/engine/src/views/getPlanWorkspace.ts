import { stat } from 'node:fs/promises';
import {
	BrainstormDecisions,
	DecisionsRecord,
	DedupReport,
	GradeReport,
	PlanFacts,
	type PlanWorkspaceListing,
	type PlanWorkspaceView,
} from '#src/contracts/index.ts';
import { planWorkspaceDir } from '#src/plan/index.ts';
import type { PlanWorkspaceFiles } from '#src/views/common/types/PlanWorkspaceFiles.ts';
import { buildPlanWorkspaceListing } from '#src/views/common/utils/buildPlanWorkspaceListing.ts';
import { matchPlanRuns } from '#src/views/common/utils/matchPlanRuns.ts';
import { readPlanRecord } from '#src/views/common/utils/readPlanRecord.ts';
import { readPlanWorkspaceFiles } from '#src/views/common/utils/readPlanWorkspaceFiles.ts';
import { listRuns } from '#src/views/listRuns.ts';
import { PlanWorkspaceNotFoundError } from '#src/views/PlanWorkspaceNotFoundError.ts';

/** A workspace name that could only address something outside the plans folder — the defence `getPlanDocument` applies to its path. */
const escapesPlansFolder = ({ name }: { name: string }) => name === '' || name === '..' || name.includes('/') || name.includes('\\');

/**
 * Every JSON record the workspace holds, each read leniently.
 *
 * `readPlanFacts` and its siblings are deliberately not used: they throw on a
 * missing or corrupt file, which is correct for a pipeline that must not proceed
 * on half an answer, and wrong for a viewer whose job is to show a half-finished
 * workspace. Each file that exists and will not parse becomes a line instead.
 */
const readRecords = async ({ cwd, files }: { cwd: string; files: PlanWorkspaceFiles }) => {
	const [facts, decisions, brainstormDecisions, grade, dedup] = await Promise.all([
		readPlanRecord({ cwd, file: files.others.get('facts.json'), schema: PlanFacts }),
		readPlanRecord({ cwd, file: files.others.get('decisions.json'), schema: DecisionsRecord }),
		readPlanRecord({ cwd, file: files.others.get('brainstorm-decisions.json'), schema: BrainstormDecisions }),
		readPlanRecord({ cwd, file: files.others.get('grade.json'), schema: GradeReport }),
		readPlanRecord({ cwd, file: files.others.get('dedup.json'), schema: DedupReport }),
	]);

	return {
		facts: facts.value,
		decisions: decisions.value,
		brainstormDecisions: brainstormDecisions.value,
		grade: grade.value,
		dedup: dedup.value,
		problems: [facts, decisions, brainstormDecisions, grade, dedup].flatMap((record) => (record.problem === undefined ? [] : [record.problem])),
	};
};

interface Params {
	cwd: string;
	name: string;
}

/**
 * One plan workspace, whole: its files, its parsed records, and the runs that
 * implemented it.
 *
 * @param cwd - the repo whose `.lightsout/plans/` is read
 * @param name - the workspace's kebab folder name, exactly as the URL carried it
 * @throws {PlanWorkspaceNotFoundError} When no folder under `.lightsout/plans/` answers to the name.
 */
export const getPlanWorkspace = async ({ cwd, name }: Params): Promise<PlanWorkspaceView> => {
	if (escapesPlansFolder({ name })) {
		throw new PlanWorkspaceNotFoundError({ name });
	}

	const rootPath = planWorkspaceDir({ cwd, name });
	const stats = await stat(rootPath).catch(() => undefined);

	if (stats?.isDirectory() !== true) {
		throw new PlanWorkspaceNotFoundError({ name });
	}

	const files = await readPlanWorkspaceFiles({ cwd, name });
	const runs = matchPlanRuns({ name, runs: await listRuns({ cwd }) });
	const { facts, decisions, brainstormDecisions, grade, dedup, problems } = await readRecords({ cwd, files });
	const listing: PlanWorkspaceListing = buildPlanWorkspaceListing({
		name,
		files,
		hasGrade: files.others.get('grade.json') !== undefined,
		grade: grade?.grade,
		runs,
	});

	return {
		listing,
		rootPath,
		planFile: files.planFile,
		phaseFiles: files.phaseFiles,
		notesFile: files.notesFile,
		facts,
		decisions,
		brainstormDecisions,
		grade,
		dedup,
		transcripts: files.transcripts,
		runs,
		problems,
	};
};
