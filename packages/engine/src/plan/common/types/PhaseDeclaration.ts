/**
 * What the overview declares about one phase: its size, and the work of it that
 * crosses a phase boundary. The phase file itself holds the complete file list —
 * repeating it here would create two lists that drift the moment either is
 * edited. This exists so phase agents can author concurrently before any phase
 * file is on disk, and so the size check can run before any of them is paid for.
 */
export interface PhaseDeclaration {
	/** 1-based phase number, from the `## Phases` table's first column. */
	number: number;
	/** The phase file's basename, e.g. `phase1-lint-vocabulary.md`. */
	file: string;
	/** The one-line scope from the `## Phases` table. */
	scope: string;
	/** Declared count of source files this phase creates; undefined when the table cell is missing or not an integer. */
	createdCount?: number;
	/** Declared count of source files this phase touches in any way; undefined when the table cell is missing or not an integer. */
	touchedCount?: number;
	/** Repo-relative paths this phase creates that a later phase builds against. */
	creates: string[];
	/** Exported symbol names later phases import. */
	exports: string[];
	/** package.json script names this phase adds. */
	scripts: string[];
	/** The phase's declared `## File Budget`, absent when it takes the configured default. */
	fileBudget?: number;
	/** 1-based line of this phase's row in the overview's `## Phases` table; absent for a declaration block with no matching row. */
	rowLine?: number;
	/** 1-based inclusive line range of this phase's `### Phase <N>` block; absent for a table row with no matching block. */
	blockRange?: { start: number; end: number };
}
