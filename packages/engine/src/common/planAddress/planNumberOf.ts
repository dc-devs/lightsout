interface Params {
	/** A plan id, whose first three characters are its number. */
	id: string;
}

/**
 * The number a plan id leads with — 1 for `001-search-basics`.
 *
 * The number is the whole of a plan's ordering: plans implement lowest first,
 * and plan 001 is the one a single-plan ticket takes its implementation from.
 * An id the `PlanId` contract would refuse answers `NaN`, which compares false
 * against every number, so a caller ordering by it never silently accepts one.
 */
export const planNumberOf = ({ id }: Params): number => Number.parseInt(id.slice(0, 3), 10);
