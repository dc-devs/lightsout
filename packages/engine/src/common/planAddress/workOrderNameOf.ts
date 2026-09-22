import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';

interface Params {
	/** A plan address, or a legacy plan folder's name. */
	name: string;
}

/**
 * The ticket folder a plan name belongs to: the first segment of a plan
 * address, or the whole of a legacy name.
 *
 * This is the key the branch, the worktree path and the worktree's ownership
 * record are all built from, so a later plan of one ticket lands in the same
 * tree on the same branch as the first.
 */
export const workOrderNameOf = ({ name }: Params): string => parsePlanAddress({ name })?.workOrderName ?? name;
