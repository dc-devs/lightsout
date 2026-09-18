import { join } from 'node:path';
import { plansDir } from '#src/plan/plansDir.ts';

interface Params {
	/** The directory the command runs in — a primary checkout, a linked worktree, or no repository at all. */
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
}

/**
 * The one answer to where a plan lives: a single gitignored folder holding both
 * the transient working files (`facts.json`, `decisions.json`, the agent
 * transcripts) and the drafted plan text — `plan.md`, or `overview.md` plus its
 * `phase<N>-<slug>.md` files.
 *
 * Always under the primary checkout, whichever checkout the command runs in, the
 * way `resolveSharedStateDir` answers for shared run state. A planning worktree
 * is removed once its work ships, so a plan folder written inside one dies with
 * it — and a worktree holds code work only. `plansDir` answers which checkout
 * holds them all; this names one folder inside that answer.
 */
export const planWorkspaceDir = async ({ cwd, name }: Params): Promise<string> => join(await plansDir({ cwd }), name);
