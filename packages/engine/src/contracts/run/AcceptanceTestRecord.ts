import { z } from 'zod';

/**
 * One acceptance test as the run currently maps it: seeded from a plan ledger
 * row when the ledger tests are written, and rewritten by an approved
 * disposition, so a moved, renamed or replaced test is proven under the name it
 * now carries rather than the one the plan first wrote down.
 */
export const AcceptanceTestRecord = z.object({
	/** The plan's one-line acceptance criterion, carried so the reviewer sees what the test is for. */
	criterion: z.string().min(1),
	/** Repo-relative path of the test file the criterion is stated in. */
	testFile: z.string().min(1),
	/** The exact test name inside that file. */
	testName: z.string().min(1),
	/** The gate key whose execution has to show this test passing. */
	gate: z.string().min(1),
});

export type AcceptanceTestRecord = z.infer<typeof AcceptanceTestRecord>;
