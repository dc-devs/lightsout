import type { AcceptanceTestRecord, LedgerRow } from '#src/contracts/index.ts';

interface Params {
	rows: LedgerRow[];
}

/**
 * The manifest's opening acceptance-test mapping: one record per ledger row,
 * carrying the four fields a checkpoint proves a row by and none of the
 * plan-file bookkeeping — so the mapping a later disposition rewrites holds
 * nothing stale.
 */
export const seedAcceptanceTests = ({ rows }: Params): AcceptanceTestRecord[] =>
	rows.map(({ criterion, testFile, testName, gate }) => ({ criterion, testFile, testName, gate }));
