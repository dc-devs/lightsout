import type { CoverageBatchReport } from '#src/contracts/index.ts';
import type { CoverageBatchStopKind } from '#src/coverage/common/constants/CoverageBatchStopKind.ts';

/** One coverage batch's terminal condition, before the pipeline records it. */
export type CoverageBatchStop =
	| { kind: typeof CoverageBatchStopKind.Parked }
	| { kind: typeof CoverageBatchStopKind.Failed; error: string }
	| { kind: typeof CoverageBatchStopKind.Escalated; error: string }
	| { kind: typeof CoverageBatchStopKind.Done; report: CoverageBatchReport; changedFiles: string[] };
