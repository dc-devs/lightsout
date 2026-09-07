import { join } from 'node:path';
import { gradeMemoryFileName } from '#src/plan/common/constants/gradeMemoryFileName.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
}

/**
 * The one answer to where a plan's finding memory lives: a single record beside
 * `grade.json` holding one entry per judged finding.
 *
 * `grade.json` is overwritten every pass and is the latest verdict; this is the
 * state that crosses passes — which questions are still open, which were
 * settled and how, and what the last qualifying review measured.
 */
export const gradeMemoryPath = ({ cwd, name }: Params): string => join(planWorkspaceDir({ cwd, name }), gradeMemoryFileName);
