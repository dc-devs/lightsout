import { join } from 'node:path';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
}

/**
 * The one answer to where a plan lives: a single gitignored folder holding both
 * the transient working files (`facts.json`, `decisions.json`, the agent
 * transcripts) and the drafted plan text — `plan.md`, or `overview.md` plus its
 * `phase<N>-<slug>.md` files.
 */
export const planWorkspaceDir = ({ cwd, name }: Params): string => join(cwd, '.lightsout', 'plans', name);
