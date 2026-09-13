interface Params {
	/** The ticket folder's name, which is also the branch every plan of that ticket implements on. */
	ticketBranch: string;
	planId: string;
}

/**
 * Write a plan's address. The one writer of the shape `parsePlanAddress` reads,
 * so the separator is spelled in exactly that pair.
 */
export const formatPlanAddress = ({ ticketBranch, planId }: Params): string => `${ticketBranch}/${planId}`;
