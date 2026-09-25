import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { BranchPhase } from '#src/contracts/queue/BranchPhase.ts';
import { ShipBlockReason } from '#src/contracts/ship/ShipBlockReason.ts';
import { ShipStatus } from '#src/contracts/ship/ShipStatus.ts';
import { takeGateHold } from '#src/gates/gateHolds/takeGateHold.ts';
import { writeBranchState } from '#src/queue/branchState/writeBranchState.ts';
import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';
import type { ShipIntegration } from '#src/ship/common/types/ShipIntegration.ts';
import type { ShipSettings } from '#src/ship/common/types/ShipSettings.ts';
import { runShip } from '#src/ship/runShip.ts';
import { reconcileShippedTicket } from '#src/ticketLifecycle/reconcileShippedTicket.ts';
import { createWorkOrderShipGuard } from '#src/workOrder/implementRun/createWorkOrderShipGuard.ts';
import { deleteWorktreeRecord } from '#src/worktree/records/deleteWorktreeRecord.ts';
import { removeWorktree } from '#src/worktree/removeWorktree.ts';

interface Params {
	/** The main repository checkout. */
	cwd: string;
	config: LightsoutConfig;
	shipSettings: ShipSettings;
	/** The effective config and harness the shared ship sequence's integration step verifies and repairs with. */
	integration: ShipIntegration;
	defaultBranch: string;
	/** The process environment the tracker credentials are read from. Passed rather than read, so a test never needs to mutate `process.env`. */
	env: NodeJS.ProcessEnv;
	outcome: WorkOrderRunOutcome;
	/** The coordinator run's id, recorded on any hold this merge has to take. */
	runId: string;
	/** Runs a task with no other main-checkout git mutation in flight. The merge tail removes a worktree there while builders may be adding one. */
	serializeMainCheckout: <Result>(params: { task: () => Promise<Result> }) => Promise<Result>;
	onProgress?: (message: string) => void;
}

/**
 * The tail of a merge that landed: the branch's record, its worktree, and the
 * tracker.
 *
 * Recorded before the cleanup that depends on it: `removeWorktree` deletes the
 * evidence a later run would otherwise read, and the tracker write below can
 * fail, so a process killed anywhere in this tail must still leave the branch
 * recorded merged rather than ready to merge again. The ownership record goes
 * after it, and only when the tree really came down — a record dropped beside a
 * tree still standing is one nothing claims.
 *
 * The merge is what the Done write is evidence of, so it happens last — and a
 * tracker that refuses the write leaves the ship recorded as successful,
 * carrying the reason beside it instead of flipping `ready`.
 *
 * @returns why the ticket's tracker state could not be reconciled, or undefined once it was
 */
const settleLandedMerge = async ({
	cwd,
	config,
	env,
	outcome,
	ticketRef,
	mergeCommit,
	serializeMainCheckout,
	onProgress,
}: {
	cwd: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	outcome: WorkOrderRunOutcome;
	/** The shipped result's `ticketRef` and `mergeCommit`, optional because `ShipResult` states them in prose rather than in the type. */
	ticketRef: string | undefined;
	mergeCommit: string | undefined;
	serializeMainCheckout: Params['serializeMainCheckout'];
	onProgress?: (message: string) => void;
}) => {
	await writeBranchState({ cwd, branch: outcome.branch, phase: BranchPhase.Merged, onProgress });
	// The one main-checkout mutation in this step: a builder may be adding a
	// worktree there in the same turn, so the removal takes the shared chain.
	const removal = await serializeMainCheckout({ task: () => removeWorktree({ cwd, worktreePath: outcome.worktreePath, branch: outcome.branch }) });

	if (removal === undefined) {
		await deleteWorktreeRecord({ cwd, branch: outcome.branch });
	}
	onProgress?.(`${outcome.ticket.identifier} · shipped as ${mergeCommit}`);

	return reconcileShippedTicket({ config, env, ticketRef, onProgress });
};

/**
 * One ticket's branch, merged — or the same outcome with `ready` flipped and
 * the reason on it.
 *
 * The answer carries `ready` exactly when the merge landed, which is how the
 * drain knows a re-read of the tracker is worth making: only a merge can finish
 * a blocker's ticket and free whatever was waiting on it.
 *
 * Fetching, integrating the default branch and re-running the gates are the
 * shared ship sequence's job now, for every caller rather than this one — so a
 * conflict arrives here as the ship result's own `integration-conflict` reason
 * instead of as a rebase this file ran itself.
 *
 * A park writes no record, so an unsettled conflict, a red gate and a blocked
 * merge all leave the branch recorded ready: the work is finished and only the
 * merge failed, so the next run re-ships it rather than spending a worker on
 * re-doing it.
 *
 * The one exception is a ship the branch's own ticket record does not authorize.
 * That is not a failed merge but a ticket still open, so the branch is recorded
 * open and the next drain gives it back to its worker — which builds a plan added
 * since the branch went ready, or surfaces a record that diverged — instead of
 * re-attempting the same refused merge on every drain.
 *
 * Serial ordering is not this function's job — `runDrainLanes` calls it once
 * per branch and never twice at a time, which is what makes integrating
 * `origin/<default>` meaningful. `runShip`'s closing cleanup knows it is inside
 * a worktree and skips itself there; the next branch's own fetch picks this
 * merge up from the remote rather than from a local branch.
 *
 * @returns the same outcome, `ready` flipped to false when it could not merge
 */
export const shipOneBranch = async ({
	cwd,
	config,
	shipSettings,
	integration,
	defaultBranch,
	env,
	outcome,
	runId,
	serializeMainCheckout,
	onProgress,
}: Params): Promise<WorkOrderRunOutcome> => {
	const park = ({ error }: { error: string }) => {
		onProgress?.(`${outcome.ticket.identifier} · not shipped: ${error}`);

		return { ...outcome, ready: false, error };
	};

	onProgress?.(`${outcome.ticket.identifier} · merging ${outcome.branch} into origin/${defaultBranch}`);

	const shipped = await runShip({
		cwd: outcome.worktreePath,
		settings: shipSettings,
		integration,
		workOrderGuard: createWorkOrderShipGuard({ config, env, onProgress }),
		onProgress,
	});

	// A ship that never got the machine parks exactly as any other block does —
	// the worktree stays and the drain carries on with other tickets — but the
	// reason a human reads names the machine rather than gate output nothing
	// produced, and the hold is what makes the stop stick until a human releases
	// it. Taken here, after `runShip` returned, so no gate reservation is held
	// while the tracker calls run.
	if (shipped.status === ShipStatus.Blocked && shipped.reason === ShipBlockReason.IntegrationGatesUnavailable) {
		const coordination = shipped.detail ?? 'the shared gate reservation was never acquired';
		const holdFailure = await takeGateHold({
			cwd,
			config,
			env,
			ticketRef: outcome.ticket.identifier,
			runId,
			worktreePath: outcome.worktreePath,
			reason: coordination,
			onProgress,
		});

		return park({ error: holdFailure === undefined ? coordination : `${coordination} ${holdFailure}` });
	}

	if (shipped.status === ShipStatus.Blocked && shipped.reason === ShipBlockReason.WorkOrderNotAuthorized) {
		const waiting = shipped.detail ?? 'the branch’s ticket record does not authorize shipping it';

		onProgress?.(`${outcome.ticket.identifier} · left open: ${waiting}`);
		await writeBranchState({ cwd, branch: outcome.branch, phase: BranchPhase.Open, onProgress });

		return { ...outcome, ready: false, open: waiting };
	}

	if (shipped.status === ShipStatus.Blocked) {
		return park({ error: `${shipped.reason}: ${shipped.detail}` });
	}

	const reconciliationFailure = await settleLandedMerge({
		cwd,
		config,
		env,
		outcome,
		ticketRef: shipped.ticketRef,
		mergeCommit: shipped.mergeCommit,
		serializeMainCheckout,
		onProgress,
	});

	return reconciliationFailure === undefined ? outcome : { ...outcome, reconciliationFailure };
};
