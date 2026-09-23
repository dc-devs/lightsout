import { z } from 'zod';

/**
 * Three digits, a hyphen, and a slug of lowercase letter-and-digit words joined
 * by single hyphens. `000` is refused because the next number a work order
 * allocates is one above the highest it has ever held, which is 001 for a
 * work order with no plans, so no plan is ever numbered zero.
 */
const planIdShape = /^(?!000-)\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const maxSlugLength = 40;

/**
 * A plan's stable identity within its ticket: `001-search-basics`.
 *
 * The number gives the order plans implement in and the slug makes the folder
 * and the attachment titles readable. Both are fixed for the life of the plan —
 * a plan's display title is a separate, mutable field — because the id is what
 * a ship request, an exclusion and every published attachment name.
 */
export const PlanId = z
	.string()
	.regex(
		planIdShape,
		"a plan id is three digits from 001 to 999, a hyphen, and lowercase letter-and-digit words joined by single hyphens — for example '001-search-basics'",
	)
	.refine((id) => {
		/** Past the three digits and the hyphen that follow them. */
		const slugStart = 4;

		return id.length - slugStart <= maxSlugLength;
	}, `a plan id's slug is at most ${maxSlugLength} characters`);

export type PlanId = z.infer<typeof PlanId>;
