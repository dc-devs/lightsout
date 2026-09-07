import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { readGitCommitsAhead } from '#src/common/git/readGitCommitsAhead.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import { BranchPhase } from '#src/contracts/index.ts';
import { readBranchState, writeBranchState } from '#src/queue/branchState/index.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { getWorktreesRoot } from '#src/queue/common/utils/getWorktreesRoot.ts';
import { toPlanningSummaries } from '#src/queue/common/utils/toPlanningSummaries.ts';
import { readTicketMatch, type ShipSettings } from '#src/ship/index.ts';
import { getTicketsByIdentifiers, setParkedLabel, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	/** The main repository checkout. */
	cwd: string;
	defaultBranch: string;
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	shipSettings: ShipSettings;
	onProgress?: (message: string) => void;
}

/** One worktree git knows about: where it is and which branch it holds. */
interface ParkedTree {
	path: string;
	branch: string;
	identifier: string;
}

/** What both classification steps below need. Declared once because they take the same things and one calls the other. */
interface ClassifyParams {
	/** The main repository checkout, where every branch-state record lives. */
	cwd: string;
	tree: ParkedTree;
	defaultBranch: string;
	onProgress?: (message: string) => void;
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
const listQueueWorktrees = async ({ cwd, shipSettings, onProgress }: Omit<Params, 'defaultBranch' | 'settings' | 'trackerSettings'>) => {
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
 * The bucket for a tree nothing has recorded yet, and the record written from
 * it — today's git count, made durable so no later scan has to run it again.
 *
 * The write is narrower than the bucket on purpose: a count git could not give
 * is not a fact worth recording. Records are never deleted and a recorded phase
 * short-circuits the count above, so persisting `building` for an answer git
 * never gave would send a branch that already carries finished commits back to
 * a worker on every future scan, with the count that would have found it never
 * running again.
 */
const classifyUnrecordedTree = async ({ cwd, tree, defaultBranch, onProgress }: ClassifyParams) => {
	const ahead = await readGitCommitsAhead({ cwd: tree.path, defaultBranch });

	if (ahead === undefined) {
		return 'drain' as const;
	}

	const carriesCommits = ahead > 0;

	await writeBranchState({ cwd, branch: tree.branch, phase: carriesCommits ? BranchPhase.Ready : BranchPhase.Building, onProgress });

	return carriesCommits ? ('ship' as const) : ('drain' as const);
};

/**
 * Where one parked worktree goes next, read from the branch's own record rather
 * than guessed from the directory.
 *
 * `merged` settles the tree whatever it holds — nothing is waiting on it. Below
 * that a dirty tree wins: sending uncommitted work to the merge would merge
 * none of it, and the drain still ends the branch merged in the same run,
 * because the ticket's own run commits what is there and records `ready` again.
 * Only with no record at all does git decide, and the answer is written down.
 */
const classifyTree = async ({ cwd, tree, defaultBranch, onProgress }: ClassifyParams) => {
	const recorded = await readBranchState({ cwd, branch: tree.branch });

	if (recorded?.phase === BranchPhase.Merged) {
		return 'settled' as const;
	}

	const changed = await readGitChangedFiles({ cwd: tree.path });

	if (changed === undefined) {
		return 'unreadable' as const;
	}

	if (changed.length > 0) {
		return 'drain' as const;
	}

	if (recorded !== undefined) {
		return recorded.phase === BranchPhase.Ready ? ('ship' as const) : ('drain' as const);
	}

	return classifyUnrecordedTree({ cwd, tree, defaultBranch, onProgress });
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
 * A worktree whose ticket no longer carries a planning-status label is left
 * alone with a warning — a removed label is the user withdrawing the
 * automation, and the tree is theirs to inspect or delete. So is one whose
 * label was changed back to a shaping state, for the same reason.
 */
export const scanParkedWorktrees = async ({
	cwd,
	defaultBranch,
	settings,
	trackerSettings,
	shipSettings,
	onProgress,
}: Params): Promise<ParkedWork | QueueFailure> => {
	const trees = await listQueueWorktrees({ cwd, shipSettings, onProgress });

	if (trees.length === 0) {
		return { resumed: [], outcomes: [], leftBehind: [], merged: [] };
	}

	const tickets = await getTicketsByIdentifiers({ settings: trackerSettings, identifiers: trees.map((tree) => tree.identifier) });

	if ('error' in tickets) {
		return tickets;
	}

	// Resumed: the worktree on disk is already the evidence the queue selected
	// this ticket, so the status half of the pair has been answered — a parked
	// ticket sits at the in-progress status by construction.
	const summaries = tickets.flatMap((ticket) => toPlanningSummaries({ ticket, lifecycle: settings.lifecycle, resumed: true }));
	const parked: ParkedWork = { resumed: [], outcomes: [], leftBehind: [], merged: [] };

	for (const tree of trees) {
		const matched = summaries.filter((ticket) => ticket.identifier.toLowerCase() === tree.identifier.toLowerCase());

		if (matched.length === 0) {
			const reason = `its worktree at ${tree.path} is parked, but the ticket carries no planning status label any more`;

			onProgress?.(`${tree.identifier} · ${reason}`);
			parked.leftBehind.push({ identifier: tree.identifier, reason });
			continue;
		}

		const runnable = matched.filter((ticket) => ticket.worker !== undefined);

		if (runnable.length === 0) {
			const carried = matched.map((ticket) => `'${settings.lifecycle.planningStatusLabels[ticket.planningStatus]}'`).join(' and ');
			const reason = `its worktree at ${tree.path} is parked, but the ticket now carries ${carried}, which the queue never resumes`;

			onProgress?.(`${tree.identifier} · ${reason}`);
			parked.leftBehind.push({ identifier: tree.identifier, reason });
			continue;
		}

		const bucket = await classifyTree({ cwd, tree, defaultBranch, onProgress });
		const ticket = runnable[0];

		if (bucket === 'settled') {
			onProgress?.(`${tree.identifier} · its branch is recorded merged, so it is reconciled rather than resumed`);
			parked.merged.push({ worktreePath: tree.path, branch: tree.branch, ticket });
			continue;
		}

		if (bucket === 'drain') {
			const cleared = await setParkedLabel({ settings: trackerSettings, ticketId: ticket.id, label: settings.parkedLabel, parked: false });

			if (cleared !== undefined) {
				onProgress?.(`${tree.identifier} · the parked label could not be cleared: ${cleared.error}`);
			}

			parked.resumed.push(...runnable);
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
