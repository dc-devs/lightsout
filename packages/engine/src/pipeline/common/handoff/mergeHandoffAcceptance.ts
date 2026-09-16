import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import type { AcceptanceTestRecord, LedgerRow, RunManifest } from '#src/contracts/index.ts';
import { seedAcceptanceTests } from '#src/pipeline/steps/ledger/index.ts';

interface Params {
	manifest: RunManifest;
	rows: LedgerRow[];
}
export const mergeHandoffAcceptance = ({ manifest, rows }: Params): AcceptanceTestRecord[] => {
	const seeded = seedAcceptanceTests({ rows });
	return manifest.planningHandoff ? [...new Map([...manifest.acceptanceTests, ...seeded].map((row) => [canonicalJson({ value: row }), row])).values()] : seeded;
};
