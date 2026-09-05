import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import { BranchPhase, type LightsoutConfig, ShipStatus } from '#src/contracts/index.ts';
import { runGates } from '#src/gates/index.ts';
import { writeBranchState } from '#src/queue/branchState/index.ts';
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
	/** The ready outcome whose branch is being merged. */
	outcome: TicketRunOutcome;
	/** Runs a task with no other main-checkout git mutation in flight. The merge tail removes a worktree there while builders may be adding one. */
	serializeMainCheckout: <Result>(params: { task: () => Promise<Result> }) => Promise<Result>;
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

/**
 * One ticket's branch, rebased onto the tip of the default branch as the remote
 * holds it now, re-gated and merged — or the same outcome with `ready` flipped
 * and the reason on it.
 *
 * The answer carries `ready` exactly when the merge landed, which is how the
 * drain knows a re-read of the tracker is worth making: only a merge can finish
 * a blocker's ticket and free whatever was waiting on it.
 *
 * A park writes no record, so a rebase conflict, a red gate after the rebase
 * and a blocked merge all leave the branch recorded ready: the work is
 * finished and only the merge failed, so the next run re-ships it rather than
 * spending a worker on re-doing it.
 *
 * Serial ordering is not this function's job any more — `runDrainLanes` calls
 * it once per branch and never twice at a time, which is what makes rebasing
 * onto `origin/<default>` meaningful. `runShip`'s closing cleanup knows it is
 * inside a worktree and skips itself there; the next branch's rebase does its
 * own fetch, so it picks this merge up from the remote rather than from a local
 * branch.
 *
 * @param outcome - the ready outcome whose branch is being merged
 * @param serializeMainCheckout - wraps the worktree removal, the one thing here that touches the main checkout
 * @returns the same outcome, `ready` flipped to false when it could not merge
 */
export const shipOneBranch = async ({
	cwd,
	config,
	shipSettings,
	defaultBranch,
	env,
	outcome,
	serializeMainCheckout,
	onProgress,
}: Params): Promise<TicketRunOutcome> => {
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

	// Recorded before the cleanup that depends on it: `removeTicketWorktree`
	// deletes the evidence a later run would otherwise read, and the tracker
	// write below can fail, so a process killed anywhere in this tail must still
	// leave the branch recorded merged rather than ready to merge again.
	await writeBranchState({ cwd, branch: outcome.branch, phase: BranchPhase.Merged, onProgress });
	// The one main-checkout mutation in this step: a builder may be adding a
	// worktree there in the same turn, so the removal takes the shared chain.
	await serializeMainCheckout({ task: () => removeTicketWorktree({ cwd, worktreePath: outcome.worktreePath, branch: outcome.branch }) });
	onProgress?.(`${outcome.ticket.identifier} · shipped as ${shipped.mergeCommit}`);

	// The merge is what the Done write is evidence of, so it happens after it —
	// and a tracker that refuses the write leaves the ship recorded as
	// successful, carrying the reason beside it instead of flipping `ready`.
	const reconciliationFailure = await reconcileShippedTicket({ config, env, ticketRef: shipped.ticketRef, onProgress });

	return reconciliationFailure === undefined ? outcome : { ...outcome, reconciliationFailure };
};
