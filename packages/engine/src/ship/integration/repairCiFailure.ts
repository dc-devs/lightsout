import { ShipBlockReason } from '#src/contracts/index.ts';
import type { ShipIntegration } from '#src/ship/common/types/ShipIntegration.ts';
import type { IntegrationFailure } from '#src/ship/integration/common/types/IntegrationFailure.ts';
import { invokeShipIntegrator } from '#src/ship/integration/invokeShipIntegrator.ts';

interface Params {
	cwd: string;
	integration: ShipIntegration;
	branch: string;
	defaultBranch: string;
	/** The ticket the branch belongs to, which is the outer bound on what a repair may touch. */
	ticketRef: string;
	/** The branch's own diff against the commit it was cut from, captured before the first integration and unchanged across retries. */
	branchDiff: string;
	/** The failing run's own output for the exact commit that was pushed. */
	ciEvidence: string;
	standards?: string;
	onProgress?: (message: string) => void;
}

/**
 * One scoped repair of a demonstrated remote-check failure, inside the
 * integration transaction that owns the tree.
 *
 * It calls the integrator once and answers what happened. It does not commit,
 * does not run the gates, does not fetch the evidence and does not own the
 * outer retries — the parent transaction rebuilds, verifies and rolls back, and
 * a complete report here merely earns the tree that verification rather than
 * standing in for it.
 *
 * Anything but a completed report is a blocked ship carrying the agent's own
 * words: an unclear cause, a fix that would need work the branch never set out
 * to do, and a harness that would not answer all read the same way, because
 * none of them is evidence the candidate was repaired.
 *
 * @returns undefined when the repair completed, else the blocked check failure to restore and report
 */
export const repairCiFailure = async ({
	cwd,
	integration,
	branch,
	defaultBranch,
	ticketRef,
	branchDiff,
	ciEvidence,
	standards,
	onProgress,
}: Params): Promise<IntegrationFailure | undefined> => {
	onProgress?.(`integrate: repairing the remote check failure reported for ${ticketRef}`);

	const refusal = await invokeShipIntegrator({ cwd, integration, branch, defaultBranch, standards, ticketRef, branchDiff, ciEvidence });

	if (refusal === undefined) {
		return undefined;
	}

	return { reason: ShipBlockReason.ChecksFailed, detail: `the remote check failure could not be repaired within this branch's scope: ${refusal}`, paths: [] };
};
