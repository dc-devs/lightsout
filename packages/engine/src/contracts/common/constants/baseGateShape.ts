import { z } from 'zod';
import { renamedKey } from '#src/contracts/common/utils/renamedKey.ts';

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
	testUnit: renamedKey({ from: 'testUnit', to: 'test' }),
	/** Removed — renamed to `test-coverage`. Same reason. */
	testCoverage: renamedKey({ from: 'testCoverage', to: 'test-coverage' }),
};
