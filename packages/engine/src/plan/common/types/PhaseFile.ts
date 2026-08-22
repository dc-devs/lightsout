import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';

/** One parsed plan file, with the identity every finding is labelled by. */
export interface PhaseFile {
	/** Absolute path on disk. */
	path: string;
	/** Basename — `phase2-cross-phase-checks.md`, `overview.md`, or `plan.md`. This is the `phase` label on every finding. */
	base: string;
	/** 1-based phase number parsed from the basename; 1 for a single `plan.md`, 0 for `overview.md`. */
	number: number;
	plan: ParsedPlan;
}
