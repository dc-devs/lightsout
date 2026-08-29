import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { getWorktreesRoot } from '#src/queue/common/utils/getWorktreesRoot.ts';
import { getTicketsByIdentifiers, setParkedLabel } from '#src/queue/tracker/index.ts';
import { readTicketMatch, type ShipSettings } from '#src/ship/index.ts';

interface Params {
	/** The main repository checkout. */
	cwd: string;
	defaultBranch: string;
	settings: QueueSettings;
	shipSettings: ShipSettings;
	onProgress?: (message: string) => void;
}

/** One worktree git knows about: where it is and which branch it holds. */
interface ParkedTree {
	path: string;
	branch: string;
	identifier: string;
}

/**
 * The queue's own spelling of a worktree path, or undefined when the path is
 * not one of the queue's worktrees at all.
 *
 * Git answers filesystem-resolved paths, so wherever the checkout sits behind a
 * symlink the two spellings differ. Re-rooting keeps every path the queue
 * prints, hands to a worker and removes after a merge in one form — the form
 * `createTicketWorktree` builds for a ticket picked up fresh.
 */
const toQueuePath = ({ path, root, realRoot }: { path: string; root: string; realRoot: string }) => {
	for (const prefix of [root, realRoot]) {
		if (path.startsWith(`${prefix}/`)) {
			return join(root, path.slice(prefix.length + 1));
		}
	}

	return undefined;
};

/**
 * The queue's own worktrees, read from git rather than from the directory
 * listing: a slash-bearing branch template nests directories, so an entry name
 * is not a branch name.
 */
const listQueueWorktrees = async ({ cwd, shipSettings, onProgress }: Omit<Params, 'defaultBranch' | 'settings'>) => {
	const listed = await runCommand({ command: 'git worktree list --porcelain', cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);
	const root = getWorktreesRoot({ cwd });
	const realRoot = await realpath(root).catch(() => root);
	const trees: ParkedTree[] = [];

	for (const block of (listed?.exitCode === 0 ? listed.stdout : '').split('\n\n')) {
		const reported = /^worktree (.+)$/m.exec(block)?.[1];
		const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
		const path = reported === undefined ? undefined : toQueuePath({ path: reported, root, realRoot });

		if (path === undefined || branch === undefined) {
			continue;
		}

		const identifier = readTicketMatch({ branch, ticketPattern: shipSettings.ticketPattern })?.ticket;

		if (identifier === undefined) {
			// A template edited between drains, or a tree someone made by hand.
			// Either way it is not ours to touch.
			onProgress?.(`leaving ${path} alone — its branch carries no ticket the configured pattern matches`);
			continue;
		}

		trees.push({ path, branch, identifier });
	}

	return trees;
};

/**
 * Where one parked worktree goes next.
 *
 * A clean tree WITH commits was parked at the ship step, so it re-enters as a
 * ready outcome — re-running its worker would spend an agent on finished work.
 * A dirty tree, or a clean one with nothing committed, goes back through the
 * drain. A tree git cannot read parks, rather than being guessed into a bucket.
 */
const classifyTree = async ({ tree, defaultBranch }: { tree: ParkedTree; defaultBranch: string }) => {
	const changed = await readGitChangedFiles({ cwd: tree.path });

	if (changed === undefined) {
		return 'unreadable' as const;
	}

	if (changed.length > 0) {
		return 'drain' as const;
	}

	const ahead = await runCommand({
		command: `git rev-list --count origin/${defaultBranch}..HEAD`,
		cwd: tree.path,
		timeoutMs: gitTimeoutMs,
	}).catch(() => undefined);
	const commits = ahead?.exitCode === 0 ? Number.parseInt(ahead.stdout.trim(), 10) : 0;

	return Number.isFinite(commits) && commits > 0 ? ('ship' as const) : ('drain' as const);
};

/**
 * What an earlier drain left on disk, and what each worktree still needs.
 *
 * The tickets are fetched by identifier with NO status filter, because the
 * status filter that keeps the queue polite is exactly what hides a parked
 * ticket from it: a ticket moved to In Progress at pickup is invisible to the
 * eligible list, so the worktree directory is the durable record of parked
 * work.
 *
 * A worktree whose ticket no longer carries a route label is left alone with a
 * warning — a removed label is the user withdrawing the automation, and the
 * tree is theirs to inspect or delete.
 */
export const scanParkedWorktrees = async ({ cwd, defaultBranch, settings, shipSettings, onProgress }: Params): Promise<ParkedWork | QueueFailure> => {
	const trees = await listQueueWorktrees({ cwd, shipSettings, onProgress });

	if (trees.length === 0) {
		return { resumed: [], outcomes: [], leftBehind: [] };
	}

	const tickets = await getTicketsByIdentifiers({ settings, identifiers: trees.map((tree) => tree.identifier) });

	if ('error' in tickets) {
		return tickets;
	}

	const parked: ParkedWork = { resumed: [], outcomes: [], leftBehind: [] };

	for (const tree of trees) {
		const matched = tickets.filter((ticket) => ticket.identifier.toLowerCase() === tree.identifier.toLowerCase());

		if (matched.length === 0) {
			const reason = `its worktree at ${tree.path} is parked, but the ticket carries no configured route label any more`;

			onProgress?.(`${tree.identifier} · ${reason}`);
			parked.leftBehind.push({ identifier: tree.identifier, reason });
			continue;
		}

		const bucket = await classifyTree({ tree, defaultBranch });
		const ticket = matched[0];

		if (bucket === 'drain') {
			const cleared = await setParkedLabel({ settings, ticketId: ticket.id, parked: false });

			if (cleared !== undefined) {
				onProgress?.(`${tree.identifier} · the parked label could not be cleared: ${cleared.error}`);
			}

			parked.resumed.push(...matched);
		} else {
			parked.outcomes.push({
				ticket,
				branch: tree.branch,
				worktreePath: tree.path,
				ready: bucket === 'ship',
				error: bucket === 'ship' ? undefined : `git could not read the worktree at ${tree.path}`,
			});
		}
	}

	return parked;
};
