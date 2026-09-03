import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import { type LightsoutConfig, ShipStatus } from '#src/contracts/index.ts';
import { runGates } from '#src/gates/index.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import { runOrDescribeFailure } from '#src/queue/common/utils/runOrDescribeFailure.ts';
import { removeTicketWorktree } from '#src/queue/removeTicketWorktree.ts';
import { runShip, type ShipSettings } from '#src/ship/index.ts';
import { reconcileShippedTicket } from '#src/ticketLifecycle/index.ts';

interface Params {
	/** The main repository checkout. */
	cwd: string;
	config: LightsoutConfig;
	shipSettings: ShipSettings;
	defaultBranch: string;
	/** The process environment the tracker credentials are read from. Passed rather than read, so a test never needs to mutate `process.env`. */
	env: NodeJS.ProcessEnv;
	/** Ready outcomes in queue order. */
	ready: TicketRunOutcome[];
	onProgress?: (message: string) => void;
}

/**
 * The branch, moved onto the tip of the default branch as the remote holds it
 * now — or the conflict that stops it, with the rebase already aborted so the
 * worktree is left where a human can read it.
 */
const rebaseOntoDefault = async ({ worktreePath, defaultBranch }: { worktreePath: string; defaultBranch: string }) => {
	const fetchFailure = await runOrDescribeFailure({ command: 'git fetch origin', cwd: worktreePath });

	if (fetchFailure !== undefined) {
		return `git could not fetch origin: ${fetchFailure}`;
	}

	const rebaseFailure = await runOrDescribeFailure({ command: `git rebase origin/${defaultBranch}`, cwd: worktreePath });

	if (rebaseFailure === undefined) {
		return undefined;
	}

	await runCommand({ command: 'git rebase --abort', cwd: worktreePath, timeoutMs: gitTimeoutMs }).catch(() => undefined);

	return `the branch would not rebase onto origin/${defaultBranch}: ${rebaseFailure}`;
};

/** One ticket's branch, rebased, re-gated and merged — or the same outcome with `ready` flipped and the reason on it. */
const shipOne = async ({ cwd, config, shipSettings, defaultBranch, env, outcome, onProgress }: Omit<Params, 'ready'> & { outcome: TicketRunOutcome }) => {
	const park = ({ error }: { error: string }) => {
		onProgress?.(`${outcome.ticket.identifier} · not shipped: ${error}`);

		return { ...outcome, ready: false, error };
	};

	onProgress?.(`${outcome.ticket.identifier} · rebasing ${outcome.branch} onto origin/${defaultBranch}`);

	const conflict = await rebaseOntoDefault({ worktreePath: outcome.worktreePath, defaultBranch });

	if (conflict !== undefined) {
		return park({ error: conflict });
	}

	// The rebase moved the branch onto commits it has never been tested
	// against, so the gates run again before anything merges.
	const { error: gateError } = await runGates({ cwd: outcome.worktreePath, config, coverage: true, onProgress });

	if (gateError !== undefined) {
		return park({ error: gateError });
	}

	const shipped = await runShip({ cwd: outcome.worktreePath, settings: shipSettings, onProgress });

	if (shipped.status === ShipStatus.Blocked) {
		return park({ error: `${shipped.reason}: ${shipped.detail}` });
	}

	await removeTicketWorktree({ cwd, worktreePath: outcome.worktreePath, branch: outcome.branch });
	onProgress?.(`${outcome.ticket.identifier} · shipped as ${shipped.mergeCommit}`);

	// The merge is what the Done write is evidence of, so it happens after it —
	// and a tracker that refuses the write leaves the ship recorded as
	// successful, carrying the reason beside it instead of flipping `ready`.
	const reconciliationFailure = await reconcileShippedTicket({ config, env, ticketRef: shipped.ticketRef, onProgress });

	return reconciliationFailure === undefined ? outcome : { ...outcome, reconciliationFailure };
};

/**
 * Merge the ready branches one at a time, oldest ticket first.
 *
 * Every merge moves the default branch, so each branch is rebased onto what the
 * remote holds *now* and re-gated before it goes anywhere: the serial rebase
 * catches conflicts rather than predicting them, and a conflict parks the
 * ticket for a human with its worktree intact.
 *
 * `runShip`'s closing cleanup knows it is inside a worktree and skips itself
 * there; the next ticket's rebase targets `origin/<default>` after its own
 * fetch, so it picks the merge up from the remote rather than from a local
 * branch.
 *
 * @returns one outcome per input, `ready` flipped to false on the ones that could not merge
 */
export const shipReadyBranches = async ({ cwd, config, shipSettings, defaultBranch, env, ready, onProgress }: Params): Promise<TicketRunOutcome[]> => {
	const shipped: TicketRunOutcome[] = [];

	for (const outcome of ready) {
		shipped.push(await shipOne({ cwd, config, shipSettings, defaultBranch, env, outcome, onProgress }));
	}

	return shipped;
};
