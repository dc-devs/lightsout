import { join } from 'node:path';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
}

/**
 * The one answer to where a plan's collected source evidence lives: a single
 * record inside that plan's own workspace folder, beside the transcripts and
 * grade records that already make a run reconstructable.
 *
 * The file name is spelled inline because this is its only consumer, and it is
 * deliberately absent from `durablePlanFileNames`: collected evidence is run
 * state, regenerable from the repository and the facts, so it never travels with
 * a published plan.
 */
export const sourceEvidencePath = ({ cwd, name }: Params): string => join(planWorkspaceDir({ cwd, name }), 'source-evidence.json');
