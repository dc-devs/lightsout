import type { CoverageBatchReport } from '#src/contracts/index.ts';

/** One coverage batch's terminal condition, before the pipeline records it. */
export type CoverageBatchStop =
	| { kind: 'parked' }
	| { kind: 'failed'; error: string }
	| { kind: 'escalated'; error: string }
	| { kind: 'done'; report: CoverageBatchReport; changedFiles: string[] };
