import type { LightsoutConfig } from '#src/contracts/index.ts';
import { applyExclusion } from '#src/workOrder/common/exclusion/applyExclusion.ts';
import { findExclusionRefusal } from '#src/workOrder/common/exclusion/findExclusionRefusal.ts';
import { verifyWorkOrderBranch } from '#src/workOrder/common/exclusion/verifyWorkOrderBranch.ts';
import { changeExistingWorkOrderState } from '#src/workOrder/common/record/changeExistingWorkOrderState.ts';
import { isPlanImplementationStarted } from '#src/workOrder/common/record/isPlanImplementationStarted.ts';
import { requireWorkOrderState } from '#src/workOrder/common/record/requireWorkOrderState.ts';
import { resolveWorkOrderPlan } from '#src/workOrder/common/record/resolveWorkOrderPlan.ts';
import type { WorkOrderStateChange } from '#src/workOrder/common/types/WorkOrderStateChange.ts';
import { pullWorkOrderState } from '#src/workOrder/pullWorkOrderState.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it. */
	cwd: string;
	/** The work order's label, which is also the branch its plans implement on. */
	name: string;
	/** A full plan id, or the plan's number on its own. */
	plan: string;
	/** Why this plan is out of the ticket's work — the record's only account of the decision. */
	reason: string;
	/** The human's declaration that this plan's implementation is off the branch, which the branch verification then backs. */
	implementationRemoved: boolean;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

/**
 * Write the exclusion, re-checking every refusal against the record as it
 * stands now: the gates just held the machine for minutes, and another command
 * on this machine or another may have moved the ticket meanwhile.
 */
const recordExclusion = async ({
	params,
	verifiedCommit,
}: {
	params: Params;
	verifiedCommit: string | undefined;
}): Promise<(WorkOrderStateChange & { withdrew: boolean }) | { error: string }> => {
	const { cwd, name, plan, reason, implementationRemoved, config, env, onProgress } = params;
	let withdrew = false;
	const updated = await changeExistingWorkOrderState({
		cwd,
		name,
		config,
		env,
		onProgress,
		change: (now) => {
			const target = resolveWorkOrderPlan({ record: now, token: plan });

			if ('error' in target) {
				return target;
			}

			const refusal = findExclusionRefusal({ record: now, target, implementationRemoved });

			if (refusal !== undefined) {
				return { error: refusal };
			}

			const applied = applyExclusion({ record: now, target, reason, implementationRemoved, verifiedCommit, at: new Date().toISOString() });

			withdrew = applied.withdrew;

			return applied.record;
		},
	});

	return 'error' in updated ? updated : { ...updated, withdrew };
};

/**
 * Take one plan out of a ticket's implementation order and its shipping
 * requirements, for good.
 *
 * An exclusion is the explicit, recorded decision that a plan is not part of
 * this ticket's work — never a deletion: the plan's files stay in their folder
 * and the plan stays on the record with whatever progress its implementation
 * reached. A plan whose implementation never started is excluded at once; one
 * whose implementation started is only excluded on a branch the repository's
 * own gates have just passed on, because the ticket's remaining plans will
 * build on that branch.
 */
export const excludeWorkOrderPlan = async (params: Params): Promise<WorkOrderStateChange | { error: string }> => {
	const { cwd, name, plan, implementationRemoved, config, env, onProgress } = params;
	const pulled = await pullWorkOrderState({ cwd, name, config, env, onProgress });

	if ('error' in pulled) {
		return pulled;
	}

	const record = requireWorkOrderState({ record: pulled.record, name });

	if ('error' in record) {
		return record;
	}

	const target = resolveWorkOrderPlan({ record, token: plan });

	if ('error' in target) {
		return target;
	}

	const refusal = findExclusionRefusal({ record, target, implementationRemoved });

	if (refusal !== undefined) {
		return { error: refusal };
	}

	// Every refusal above is settled first, so a request that was never going to
	// be granted never spends a full run of the repository's gates.
	const verification = isPlanImplementationStarted({ plan: target })
		? await verifyWorkOrderBranch({ cwd, branch: record.branch, onProgress })
		: { commit: undefined };

	if ('error' in verification) {
		return verification;
	}

	const written = await recordExclusion({ params, verifiedCommit: verification.commit });

	if ('error' in written) {
		return written;
	}

	return {
		record: written.record,
		notice: written.withdrew
			? `the pending ship request was withdrawn because plan ${target.id} is no longer part of work order ${name}'s work — ask again with \`lightsout work-order request-ship --name ${name}\``
			: undefined,
		publishError: written.publishError,
	};
};
