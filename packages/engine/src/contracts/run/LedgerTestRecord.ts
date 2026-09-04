import { z } from 'zod';

/**
 * One ledger test file as the engine locked it. The party being verified never
 * edits the verifier: the run keeps a copy of the file the ledger writer
 * produced, and every later verification compares against this hash before any
 * gate runs.
 */
export const LedgerTestRecord = z.object({
	/** Repo-relative path of the test file. */
	path: z.string().min(1),
	/** Every test name the ledger assigns to this file. */
	testNames: z.array(z.string().min(1)).min(1),
	/** SHA-256 of the file as written by the ledger writer; any later difference is reverted. */
	sha256: z.string().length(64),
});

export type LedgerTestRecord = z.infer<typeof LedgerTestRecord>;
