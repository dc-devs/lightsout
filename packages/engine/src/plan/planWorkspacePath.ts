import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';

interface Params {
	/** A plan address, or the bare name of a plan shaped before its ticket exists. */
	name: string;
}

/**
 * A plan workspace addressed the way the repo writes it down: relative to the
 * repo root, with forward slashes, whatever separator this platform joins
 * absolute paths with.
 *
 * This is the spelling a run manifest's `plan` field carries and the one
 * `getPlanDocument` takes, so the code that matches runs to a plan and the code
 * that builds a file's path both ask here instead of writing the prefix twice.
 * It is `planWorkspaceDir`'s relative twin and names exactly the folder that
 * helper resolves, which is why the two spell the layout's segments together
 * rather than through a constant neither of them would be the only reader of.
 */
export const planWorkspacePath = ({ name }: Params): string => {
	const address = parsePlanAddress({ name });
	const plansFolder = `.lightsout/tickets/${address?.ticketBranch ?? name}/plans`;

	return address === undefined ? plansFolder : `${plansFolder}/${address.planId}`;
};
