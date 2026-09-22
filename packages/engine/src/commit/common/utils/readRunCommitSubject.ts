import { basename, extname } from 'node:path';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { readRunLabel } from '#src/common/utils/readRunLabel.ts';
import type { LightsoutConfig, RunManifest } from '#src/contracts/index.ts';
import { planNameFromPath } from '#src/plan/index.ts';
import { readWorkOrderState } from '#src/workOrder/index.ts';

/**
 * The unit of work this run is, named the way the folders on disk name it, and
 * the ticket folder to ask about it.
 *
 * A phase child run's plan is its own phase file inside the plan folder, so the
 * file's stem is appended to the plan id — which is how a phase names itself
 * without a second rule. A legacy folder named for its branch alone is its own
 * unit, and only a plan outside the plans directory has no name to take at all.
 */
const readUnit = async ({ cwd, plan, planName }: { cwd: string; plan: string; planName?: string }) => {
	// The run's own record of which plan it belongs to is preferred over reading
	// the name back out of the plan's path: the path is spelled by whoever started
	// the run, while the recorded name is the fact the run states about itself.
	const name = planName ?? (await planNameFromPath({ cwd, planPath: plan }));
	const stem = basename(plan, extname(plan));

	if (name === undefined) {
		return { unit: stem };
	}

	const address = parsePlanAddress({ name });
	const base = address?.planId ?? name;

	return { unit: stem === 'plan' ? base : `${base}/${stem}`, workOrderName: address?.workOrderName ?? name, planId: address?.planId };
};

/**
 * The ticket reference and the plan title the work order's state carries, or
 * neither.
 *
 * A state file that exists but cannot be read is narrated and then treated as
 * absent: nothing in the engine parses a commit subject, so failing a whole
 * verified unit over a decoration would cost far more than the fallback does.
 */
const readTicketFacts = async ({
	cwd,
	workOrderName,
	planId,
	onProgress,
}: {
	cwd: string;
	workOrderName?: string;
	planId?: string;
	onProgress: (message: string) => void;
}) => {
	if (workOrderName === undefined) {
		return {};
	}

	const read = await readWorkOrderState({ cwd, name: workOrderName });

	if ('error' in read) {
		onProgress(`the work order state for ${workOrderName} could not be read, so this commit is addressed from the branch instead — ${read.error}`);

		return {};
	}

	return { ticketRef: read.record?.ticketRef, title: read.record?.plans.find((plan) => plan.id === planId)?.title };
};

interface Params {
	/** The checkout the run built in — where the plan path resolves and the branch is read. */
	cwd: string;
	manifest: RunManifest;
	config: LightsoutConfig;
	/** The run's progress sink, for the one aside this reader has to make: a work order state that exists but cannot be read. */
	onProgress: (message: string) => void;
}

/**
 * How a plan run names its unit of work: the ticket, then the unit, then the
 * plan's title when a work order's state supplies one.
 *
 * It reads the manifest rather than taking the facts as parameters, because the
 * manifest already carries the plan path every one of them is derived from —
 * and threading them would make five callers of the pipeline responsible for a
 * fact the run records for itself.
 *
 * With no work order state the reference falls back to `readRunLabel`, the same
 * ladder `implement-direct` climbs for its own run label.
 */
export const readRunCommitSubject = async ({ cwd, manifest, config, onProgress }: Params): Promise<string> => {
	const { unit, workOrderName, planId } = await readUnit({ cwd, plan: manifest.plan, planName: manifest.planName });
	const { ticketRef, title } = await readTicketFacts({ cwd, workOrderName, planId, onProgress });
	const reference = ticketRef ?? (await readRunLabel({ cwd, config }));

	return title === undefined ? `${reference} ${unit}` : `${reference} ${unit}: ${title}`;
};
