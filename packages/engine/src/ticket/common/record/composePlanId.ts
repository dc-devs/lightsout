import { z } from 'zod';
import { PlanId } from '#src/contracts/index.ts';

interface Params {
	/** The plan's number, which becomes the id's three zero-padded digits. */
	number: number;
	/** The plan slug, fixed for the life of the plan: lowercase letter-and-digit words joined by single hyphens. */
	slug: string;
}

/**
 * The plan id these parts spell, or the one sentence saying why the slug cannot
 * be part of one.
 *
 * Shared by the only two places an id is made — `ticket add-plan` and `ticket
 * adopt` — because a slug one of them refuses must never be a slug the other
 * accepts, and a human who mistypes one reads the same sentence either way.
 */
export const composePlanId = ({ number, slug }: Params): { id: string } | { error: string } => {
	const parsed = PlanId.safeParse(`${String(number).padStart(3, '0')}-${slug}`);

	return parsed.success ? { id: parsed.data } : { error: `'${slug}' cannot be a plan slug: ${z.prettifyError(parsed.error)}` };
};
