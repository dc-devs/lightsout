import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import { WorktreeOwner } from '#src/contracts/index.ts';
import { describeGateHold, type GateHolds, isTicketGateHeld } from '#src/gates/index.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { establishBranchMerge } from '#src/queue/common/utils/establishBranchMerge.ts';
import { toPlanningSummaries } from '#src/queue/common/utils/toPlanningSummaries.ts';
import type { ParkedTree } from '#src/queue/worktrees/common/types/ParkedTree.ts';
import { settleUnmergedTree } from '#src/queue/worktrees/common/utils/settleUnmergedTree.ts';
import { readTicketMatch, type ShipSettings } from '#src/ship/index.ts';
import { getTicketsByIdentifiers, type TrackerSettings } from '#src/ticketTracker/index.ts';
import { readWorktreeRecord, resolveWorktreesRoot } from '#src/worktree/index.ts';

interface Params {
	/** The main repository checkout. */
	cwd: string;
	defaultBranch: string;
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	shipSettings: ShipSettings;
	/** The holds this drain reconciled before the scan, so a held tree is left exactly where it is. */
	holds: GateHolds;
	onProgress?: (message: string) => void;
}

/**
 * The queue's own spelling of a worktree path, or undefined when the path is
 * not one of the queue's worktrees at all.
 *
 * Git answers filesystem-resolved paths, so wherever the checkout sits behind a
 * symlink the two spellings differ. Re-rooting keeps every path the queue
 * prints, hands to a worker and removes after a merge in one form — the form
 * `createWorktree` builds for a ticket picked up fresh.
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
const listQueueWorktrees = async ({ cwd, shipSettings, onProgress }: { cwd: string; shipSettings: ShipSettings; onProgress?: (message: string) => void }) => {
	const listed = await runCommand({ command: 'git worktree list --porcelain', cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);
	const root = await resolveWorktreesRoot({ cwd });
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

		const record = await readWorktreeRecord({ cwd, branch });

		if (record !== undefined && record.owner !== WorktreeOwner.Queue) {
			// A tree a standalone run made and may still be building in. A tree
			// carrying no record at all is one an earlier drain made before
			// ownership was recorded, and is still ours to resume.
			onProgress?.(`leaving ${path} alone — it belongs to a '${record.owner}' run rather than the queue`);
			continue;
		}

		trees.push({ path, branch, identifier });
	}

	return trees;
};

/**
 * Why a parked worktree is left alone rather than resumed, or undefined when
 * its ticket still delegates the work to the queue and nothing holds it.
 *
 * Two causes, asked in that order. A removed planning-status label is the user
 * withdrawing the automation, and a label changed back to a shaping state says
 * the same thing: the tree is theirs to inspect or delete, and the queue names
 * it rather than touching it. A gate hold says a human owes the ticket a look
 * before anything runs again, and it is asked here — before the merge check,
 * and before the drain branch that would clear the parked label — so nothing
 * about a held tree is settled.
 */
const describeLeftBehind = ({
	tree,
	matched,
	runnable,
	settings,
	holds,
}: {
	tree: ParkedTree;
	matched: TicketSummary[];
	runnable: TicketSummary[];
	settings: QueueSettings;
	holds: GateHolds;
}) => {
	let reason: string | undefined;

	if (matched.length === 0) {
		reason = `its worktree at ${tree.path} is parked, but the ticket carries no planning status label any more`;
	} else if (runnable.length === 0) {
		const carried = matched.map((ticket) => `'${settings.lifecycle.planningStatusLabels[ticket.planningStatus]}'`).join(' and ');

		reason = `its worktree at ${tree.path} is parked, but the ticket now carries ${carried}, which the queue never resumes`;
	} else if (isTicketGateHeld({ holds, identifier: tree.identifier, labels: runnable[0].labels })) {
		reason = describeGateHold({ hold: holds[tree.identifier.toLowerCase()], identifier: tree.identifier });
	}

	return reason;
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
 *
 * Two questions are then asked of every tree still delegated, in that order.
 * Has the branch merged? — established the same two ways a tracker-picked
 * ticket gets, this queue's own record and then the forge, because a branch
 * someone merged by hand looks exactly like a clean tree carrying commits, and
 * shipping it a second time is the cost of guessing. Does the tracker file the
 * ticket as finished? — because a ticket a human moved to Done or Canceled
 * with its label still on is work nobody is waiting for, and resuming it would
 * write the ticket back to In Progress. A finished ticket whose branch is not
 * merged is reported and its worktree left where it is, whatever the tree
 * holds: it may hold work no one has seen.
 */
export const scanParkedWorktrees = async ({
	cwd,
	defaultBranch,
	settings,
	trackerSettings,
	shipSettings,
	holds,
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
		const runnable = matched.filter((ticket) => ticket.worker !== undefined);
		const left = describeLeftBehind({ tree, matched, runnable, settings, holds });

		if (left !== undefined) {
			onProgress?.(`${tree.identifier} · ${left}`);
			parked.leftBehind.push({ identifier: tree.identifier, reason: left });
			continue;
		}

		const ticket = runnable[0];
		const evidence = await establishBranchMerge({ cwd, branch: tree.branch, onProgress });

		if (evidence !== undefined) {
			const established =
				evidence.pullRequest === undefined ? 'its branch is recorded merged' : `its branch already has a merged pull request #${evidence.pullRequest.number}`;

			onProgress?.(`${tree.identifier} · ${established}, so it is reconciled rather than resumed`);
			parked.merged.push({ worktreePath: tree.path, branch: tree.branch, ticket });
			continue;
		}

		if (ticket.finished) {
			const reason = `its worktree at ${tree.path} is parked, but the tracker files the ticket as finished while its branch is not merged, so the worktree was left in place — it may hold work nobody has merged`;

			onProgress?.(`${tree.identifier} · ${reason}`);
			parked.leftBehind.push({ identifier: tree.identifier, reason });
			continue;
		}

		const outcome = await settleUnmergedTree({ cwd, tree, ticket, defaultBranch, settings, trackerSettings, onProgress });

		if (outcome === undefined) {
			parked.resumed.push(...runnable);
		} else {
			parked.outcomes.push(outcome);
		}
	}

	return parked;
};
