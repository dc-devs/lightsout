import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { WorkOrderEventKind } from '#src/contracts/workOrder/WorkOrderEventKind.ts';
import type { ShipWorkOrderGuard } from '#src/ship/common/types/ShipWorkOrderGuard.ts';
import { appendWorkOrderEvent } from '#src/workOrder/internal/common/record/appendWorkOrderEvent.ts';
import { pullWorkOrderState } from '#src/workOrder/pullWorkOrderState.ts';
import { readWorkOrderShipEligibility } from '#src/workOrder/readWorkOrderShipEligibility.ts';
import { readWorkOrderState } from '#src/workOrder/readWorkOrderState.ts';
import { updateSyncedWorkOrderState } from '#src/workOrder/updateSyncedWorkOrderState.ts';

interface Params {
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	/** Where a pull's narration and a shipped mark that could not be recorded are reported. Silent when omitted. */
	onProgress?: (message: string) => void;
}

/**
 * Build the work order state's say over shipping, for whichever caller is about to
 * ship: `lightsout ship`, the after-implement chain, or the queue's merge lane.
 *
 * A factory rather than a class: it holds no mutable state and has exactly the
 * two operations the contract names.
 *
 * `authorize` pulls before it answers, so a machine never authorizes a merge
 * against a record it already knows is behind — and a pull failure, a divergence
 * above all, is a refusal rather than a pass, because a record that cannot be
 * established cannot authorize anything. The one exception is a branch this
 * machine holds no record for: nothing about it is a ticket's business, so an
 * unreachable tracker cannot make it unshippable.
 */
export const createWorkOrderShipGuard = ({ config, env, onProgress }: Params): ShipWorkOrderGuard => ({
	authorize: async ({ cwd, branch }) => {
		// The branch IS the work order's label: every plan address is keyed by its
		// ticket-branch segment, so the record for the branch being shipped is the
		// one this looks up.
		const pulled = await pullWorkOrderState({ cwd, name: branch, config, env, onProgress });

		if ('error' in pulled) {
			const local = await readWorkOrderState({ cwd, name: branch });

			// A tracker that cannot be read must not stop a branch that has no record
			// here at all: such a branch is a legacy one and ships exactly as it did
			// before work order states existed. A branch that DOES have a record is
			// refused, because what its published copy says could not be established.
			return 'error' in local || local.record !== undefined ? pulled.error : undefined;
		}

		if (pulled.record === undefined) {
			return undefined;
		}

		const eligibility = readWorkOrderShipEligibility({ record: pulled.record });

		return eligibility.eligible ? undefined : eligibility.reason;
	},
	recordShipped: async ({ cwd, branch, mergeCommit }) => {
		const read = await readWorkOrderState({ cwd, name: branch });

		if ('error' in read) {
			onProgress?.(`the merge ${mergeCommit} could not be recorded on the ticket: ${read.error}`);

			return;
		}

		// A branch with no record ships exactly as it did before work order states
		// existed, so shipping one never invents a record for it.
		if (read.record === undefined) {
			return;
		}

		const at = new Date().toISOString();
		const updated = await updateSyncedWorkOrderState({
			cwd,
			name: branch,
			config,
			env,
			onProgress,
			change: (current) => {
				if (current === undefined) {
					return { error: `work order ${branch} no longer has a record, so the merge ${mergeCommit} could not be recorded on it` };
				}

				// The plans that shipped are the ones the ticket included: an excluded
				// plan took no part in the implementation that was merged.
				const planIds = current.plans.filter((plan) => plan.exclusion === undefined).map((plan) => plan.id);
				// A ticket with no included plan was implemented by its build from the
				// ticket body, which is what its history says rather than an empty list.
				const shippedWith = planIds.length === 0 ? 'from the ticket body' : `with ${planIds.join(', ')}`;

				return appendWorkOrderEvent({
					record: { ...current, shipped: { at, planIds, mergeCommit } },
					kind: WorkOrderEventKind.Shipped,
					detail: `work order ${branch} shipped as ${mergeCommit} ${shippedWith}`,
					at,
				});
			},
		});

		// A merge that already happened is never undone by a record that would not
		// take it, so both failures are reported rather than raised.
		if ('error' in updated) {
			onProgress?.(`the merge ${mergeCommit} could not be recorded on the ticket: ${updated.error}`);
		} else if (updated.publishError !== undefined) {
			onProgress?.(updated.publishError);
		}
	},
});
