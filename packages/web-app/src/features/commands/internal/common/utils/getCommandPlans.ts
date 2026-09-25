import type { CommandCatalogEntry, PlanWorkspaceListing } from '@lightsout/engine';

interface Params {
	entry: CommandCatalogEntry;
	plans: PlanWorkspaceListing[];
}

/**
 * This command's plan workspaces, narrowed exactly as its history table shows
 * them: `/brainstorm` writes notes and `/plan` drafts a plan file, so each
 * command claims the workspaces carrying its own output rather than every one.
 *
 * The card's count and the command's own table both come through here, for the
 * reason `getCommandRuns` states — narrowing at each surface would let one of
 * them change and print a different number from the other.
 */
export const getCommandPlans = ({ entry, plans }: Params): { writesNotes: boolean; listings: PlanWorkspaceListing[]; latestAt?: string } => {
	// `/brainstorm` is the one command whose output is notes; every other command
	// that records plans at all drafts a plan file.
	const writesNotes = entry.id === 'brainstorm';
	const listings = plans.filter((plan) => (writesNotes ? plan.hasNotes : plan.hasPlanFile));
	const updatedAts = listings.map((plan) => plan.updatedAt).sort();

	return { writesNotes, listings, latestAt: updatedAts[updatedAts.length - 1] };
};
