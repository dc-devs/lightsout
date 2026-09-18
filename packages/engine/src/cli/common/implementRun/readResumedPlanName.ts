import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import type { RunManifest } from '#src/contracts/index.ts';
import { planNameFromPath } from '#src/plan/index.ts';
import { readTicketRecord } from '#src/ticket/index.ts';

interface Params {
	/** The checkout the run builds in, whose primary checkout holds the ticket record. */
	cwd: string;
	/** The parked run being continued. */
	manifest: RunManifest;
}

/**
 * The plan a run being resumed belongs to, as a plan's `--name` under the plans
 * directory — or undefined when nothing names one.
 *
 * A run whose plan path lies in a plan folder answers that folder's address
 * straight away. A build from the ticket body has no plan folder in its path at
 * all, so the plan it belongs to is found the only other way there is: the ticket
 * record's own entry naming this run. That is what makes resuming single-plan
 * plan 001's body build a repair of that plan rather than of nothing.
 *
 * @returns the plan address or legacy folder name the run belongs to, or undefined
 */
export const readResumedPlanName = async ({ cwd, manifest }: Params): Promise<string | undefined> => {
	const fromPath = await planNameFromPath({ cwd, planPath: manifest.plan });

	if (fromPath !== undefined || manifest.branch === undefined) {
		return fromPath;
	}

	const read = await readTicketRecord({ cwd, ticketBranch: manifest.branch });

	if ('error' in read || read.record === undefined) {
		return undefined;
	}

	const plan = read.record.plans.find((candidate) => candidate.implementation?.runId === manifest.runId);

	return plan === undefined ? undefined : formatPlanAddress({ ticketBranch: manifest.branch, planId: plan.id });
};
