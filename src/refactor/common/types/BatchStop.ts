import type { BatchReport } from '@/contracts';

/** One batch attempt's terminal condition, before outcome classification. */
export type BatchStop =
	| { kind: 'parked' }
	| { kind: 'failed'; error: string }
	| { kind: 'escalated'; error: string }
	| { kind: 'done'; report: BatchReport; changedFiles: string[] };
