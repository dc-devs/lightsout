import type { LedgerRow } from '#src/contracts/plan/ledger/LedgerRow.ts';

/**
 * A plan's ledger rows gathered by the test file each one names — one writer's
 * assignment per file — in first-appearance order, so the warm-up spawn owns
 * the ledger's first file.
 */
export const groupLedgerRows = ({ rows }: { rows: LedgerRow[] }): Array<{ testFile: string; rows: LedgerRow[] }> => {
	const byFile = new Map<string, LedgerRow[]>();

	for (const row of rows) {
		byFile.set(row.testFile, [...(byFile.get(row.testFile) ?? []), row]);
	}

	return [...byFile].map(([testFile, fileRows]) => ({ testFile, rows: fileRows }));
};
