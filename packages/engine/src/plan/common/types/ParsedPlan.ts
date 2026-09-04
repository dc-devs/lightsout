import type { LedgerRow, ProseFile } from '#src/contracts/index.ts';
import type { PlanFileKind } from '#src/plan/common/constants/PlanFileKind.ts';

/** A parsed plan file: its `##` sections plus the paths and scripts the checks key off. */
export interface ParsedPlan {
	base: string;
	title: string;
	variant: PlanFileKind;
	/** `## Section title` → the lines beneath it (up to the next `##`). */
	sections: Map<string, string[]>;
	createPaths: string[];
	modifyPaths: string[];
	/** `## Files to Modify from Earlier Phases` — paths a prior phase creates, so absent from disk. */
	earlierPhaseModifyPaths: string[];
	/** `## Files to Delete`. */
	deletePaths: string[];
	/** `## Files to Move` — source and destination per `### ` heading. Exactly two path-shaped backtick spans per heading; a heading yielding fewer is not here, it is in `malformedMoveLines`. */
	movePaths: { from: string; to: string }[];
	/** 1-based line numbers of `## Files to Move` headings that did not yield two paths. */
	malformedMoveLines: number[];
	/** `## File Budget` — the touched-file allowance this plan or phase declares for itself, absent when it takes the configured default. */
	fileBudget?: number;
	mirrorPaths: string[];
	verificationCommands: string[];
	/** `## Acceptance Tests` — one row per criterion; empty when the section is absent. */
	ledger: LedgerRow[];
	/** 1-based line numbers of ledger rows that could not be read. */
	malformedLedgerLines: number[];
	/** `## Prose Files` — files the plan describes in words because no test states their behaviour. */
	proseFiles: ProseFile[];
	/** 1-based line numbers of prose-files bullets that name a path but state no reason. */
	malformedProseLines: number[];
	lines: string[];
}
