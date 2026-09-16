import type { LedgerRow } from '#src/contracts/index.ts';

interface Params {
	rows: LedgerRow[];
}
export const groupLedgerRows = ({ rows }: Params): Array<{ testFile: string; rows: LedgerRow[] }> => {
	const byFile = new Map<string, LedgerRow[]>();

	for (const row of rows) {
		byFile.set(row.testFile, [...(byFile.get(row.testFile) ?? []), row]);
	}

	return [...byFile].map(([testFile, fileRows]) => ({ testFile, rows: fileRows }));
};
