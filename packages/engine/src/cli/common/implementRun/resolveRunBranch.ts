import { basename, extname } from 'node:path';
import { headingOf } from '#src/common/utils/headingOf.ts';
import { renderBranchTemplate } from '#src/common/utils/renderBranchTemplate.ts';
import { toBranchSlug } from '#src/common/utils/toBranchSlug.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { planNameFromPath } from '#src/plan/index.ts';

interface Params {
	/** The checkout the command was launched from. */
	cwd: string;
	config: LightsoutConfig;
	/** `--plan` exactly as the user typed it, for a plan-based run. */
	planPath?: string;
	/** `--ticket` exactly as the user typed it, for a direct run. */
	ticketPath?: string;
	/** `--ref` exactly as the user typed it, when a direct run named one. */
	ticketRef?: string;
	/** The direct run's ticket body — its first heading supplies the `{slug}` token. */
	ticketBody?: string;
}

/** The input's own file name without its extension — what a branch is named after when no convention names it. */
const stemOf = ({ path }: { path: string }) => basename(path, extname(path));

/**
 * The branch an isolated run is put on, derived from the input the user named,
 * or the one sentence saying the input names no branch.
 *
 * Pure — it reads no disk and runs no command — which is what lets it be tested
 * on its own. Its one caller is `resolveRunWorkspace`, which calls it only once
 * isolation is decided: a run building in the launching checkout needs no
 * branch and must never be refused for failing to derive one.
 *
 * The template is read out of the `queue` block deliberately. That block is the
 * repository's single statement of how a branch is named for a ticket, and
 * `ship.ticket-pattern` is written to match it; a second template key for
 * standalone runs would let the two drift and break the
 * ticket-to-branch-to-pull-request chain.
 */
export const resolveRunBranch = ({ cwd, config, planPath, ticketPath, ticketRef, ticketBody }: Params): string | { error: string } => {
	const planName = planPath === undefined ? undefined : planNameFromPath({ cwd, planPath });
	const template = config.queue?.['branch-template'] ?? '{ticket}-{slug}';
	const input = planPath ?? ticketPath;
	let branch = '';

	if (planName !== undefined) {
		// The canonical plan-folder name, character for character: the folder, the
		// branch and the ticket pattern are one chain, and re-slugging breaks it.
		branch = planName;
	} else if (ticketRef !== undefined) {
		branch = renderBranchTemplate({ template, ticketRef, title: headingOf({ text: ticketBody ?? '' }) });
	} else if (input !== undefined) {
		branch = toBranchSlug({ text: stemOf({ path: input }) });
	}

	const named = input ?? '--ref';

	return branch === ''
		? {
				error: `no branch could be derived from '${named}' — it names no branch-safe word, so pass --no-worktree to build in the checkout this was launched from`,
			}
		: branch;
};
