import { z } from 'zod';
import { PlanId } from '#src/contracts/workOrder/PlanId.ts';

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
 * The one home of the id's shape and of the sentence refusing a slug that
 * cannot be part of one. `ticket add-plan` is the only caller left now that it
 * makes every plan, and this stays its own file because that rule earns a name:
 * inlined, the id's spelling would be one expression inside a record change
 * rather than the thing a reader looks up.
 */
export const composePlanId = ({ number, slug }: Params): { id: string } | { error: string } => {
	const parsed = PlanId.safeParse(`${String(number).padStart(3, '0')}-${slug}`);

	return parsed.success ? { id: parsed.data } : { error: `'${slug}' cannot be a plan slug: ${z.prettifyError(parsed.error)}` };
};
