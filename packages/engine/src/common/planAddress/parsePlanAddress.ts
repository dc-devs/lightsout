import type { PlanAddress } from '#src/common/types/PlanAddress.ts';
import { PlanId } from '#src/contracts/index.ts';

interface Params {
	/** Whatever a command was handed as a plan's `--name`: a plan address, or a legacy plan folder's name. */
	name: string;
}

/**
 * Read a plan address, or answer undefined for a name that is not one.
 *
 * This is the one reader of the address shape, paired with `formatPlanAddress`
 * as its one writer, so the separator and the segment rules are spelled in
 * exactly this pair. Everything else asks here — or asks `workOrderNameOf` —
 * rather than splitting a name of its own.
 *
 * Undefined is the legacy answer, not a failure: a folder named for its branch
 * alone is exactly what every plan carried before ticket records existed, and
 * it keeps working. A first segment that is empty, `.` or `..` is refused
 * because it would resolve outside the plans directory.
 */
export const parsePlanAddress = ({ name }: Params): PlanAddress | undefined => {
	const [workOrderName, planId, ...beyond] = name.split('/');
	const addressed =
		beyond.length === 0 &&
		workOrderName !== undefined &&
		planId !== undefined &&
		workOrderName !== '' &&
		workOrderName !== '.' &&
		workOrderName !== '..' &&
		PlanId.safeParse(planId).success;

	return addressed ? { workOrderName, planId } : undefined;
};
