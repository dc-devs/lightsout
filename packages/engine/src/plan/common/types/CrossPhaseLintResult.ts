import type { StructuralFinding } from '#src/contracts/index.ts';

/**
 * What a cross-phase pass returns: its findings, and the per-file findings it
 * overruled. `clearedCreates` holds `<phase base>|<path>` keys for create paths
 * an earlier phase provably removes — a legitimate delete-then-recreate the
 * per-file `path-exists` check cannot recognise on its own. The pair travels
 * from `checkFileProvenance`, which produces it, through `lintPlanCrossPhase`,
 * which forwards it unchanged, to `lintPlanStructure`, which consumes it, so it
 * is one declaration rather than a shape re-typed at each seam.
 */
export interface CrossPhaseLintResult {
	findings: StructuralFinding[];
	clearedCreates: Set<string>;
}
