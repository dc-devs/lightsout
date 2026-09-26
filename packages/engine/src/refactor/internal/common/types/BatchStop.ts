import type { BatchReport } from '#src/contracts/refactor/BatchReport.ts';
import type { BatchStopKind } from '#src/refactor/internal/common/constants/BatchStopKind.ts';

/** One batch attempt's terminal condition, before outcome classification. */
export type BatchStop =
	| { kind: typeof BatchStopKind.Parked }
	| { kind: typeof BatchStopKind.Failed; error: string }
	| { kind: typeof BatchStopKind.Escalated; error: string }
	| { kind: typeof BatchStopKind.Done; report: BatchReport; changedFiles: string[] };
