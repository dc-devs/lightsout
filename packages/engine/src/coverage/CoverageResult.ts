import type { CoverageTotal, RunManifest } from '#src/contracts/index.ts';
import type { CoverageSetAside } from '#src/coverage/common/types/CoverageSetAside.ts';

export interface CoverageResult {
	/** True only when the coverage gate went green; a parked or escalated run is false. */
	ok: boolean;
	manifest: RunManifest;
	/** Present when ok is false — what stopped the run, for the human. */
	error?: string;
	/** Declined batches' files, set aside for human review (likely need source changes). */
	setAside: CoverageSetAside[];
	/** Per-scope statements pct at run start (from the frozen worklist). */
	before: CoverageTotal[];
	/** Per-scope statements pct at the final measurement; echoes `before` when the run did not complete. */
	after: CoverageTotal[];
}
