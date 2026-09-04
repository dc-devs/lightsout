import { z } from 'zod';

/**
 * One row of a plan's `## Acceptance Tests` ledger: an acceptance criterion, and
 * the test that states it. The ledger is the executable half of a contract plan
 * — a criterion with a named test needs no prose narrating the behaviour, and
 * the gate that runs the test is what proves the criterion was met.
 */
export const LedgerRow = z.object({
	/** The acceptance criterion in one line. */
	criterion: z.string().min(1),
	/** Repo-relative path of the test file that states it. May already exist. */
	testFile: z.string().min(1),
	/** The exact test name the writer must use. */
	testName: z.string().min(1),
	/** The gate key from `gates` that runs this test; `test` when the row leaves it blank. */
	gate: z.string().min(1),
	/** 1-based line of the row in its plan file, for findings. */
	line: z.number().int().positive(),
});

export type LedgerRow = z.infer<typeof LedgerRow>;
