import { join } from 'node:path';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
}

/**
 * The one answer to where a plan's grade history lives: an append-only ledger
 * beside `grade.json`, holding one whole `GradeReport` per line.
 *
 * Every grading pass appends a line here and nothing is ever removed, which is
 * what makes it a ledger rather than a second grade file. `grade.json` still
 * holds the latest pass and is still the file to read for a verdict; this is how
 * a human sees a plan go C → B → A, and which finding kept coming back.
 */
export const gradeHistoryPath = ({ cwd, name }: Params): string => join(planWorkspaceDir({ cwd, name }), 'grade-history.jsonl');
