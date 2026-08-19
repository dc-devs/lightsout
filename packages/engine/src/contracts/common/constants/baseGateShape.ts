import { z } from 'zod';

/**
 * The keys every gate block declares, whatever scope it gates: the two
 * required commands, and the two renamed spellings kept only so a stale config
 * fails loudly instead of being silently stripped.
 *
 * Spread into a block's own `z.object({ … })` — each block still owns the gates
 * that are its alone (`generate`/`format` for the root block, the `{package}`
 * placeholder rule for the scoped one).
 */
export const baseGateShape = {
	check: z.string(),
	test: z.string(),
	/** Removed — renamed to `test`. Declared only so a stale key fails loudly instead of being silently stripped. */
	testUnit: z.never('`testUnit` was renamed to `test`').optional(),
	/** Removed — renamed to `test-coverage`. Same reason. */
	testCoverage: z.never('`testCoverage` was renamed to `test-coverage`').optional(),
};
