/**
 * The `## Decision Log` section a phase file carries instead of a table: one
 * sentence sending the reader to the complete history in the phased plan's
 * overview.
 *
 * A phased plan keeps one log, so a phase file that carried its own table would
 * be a second copy to keep in step with the record. The overview is named as a
 * bare file name rather than a backticked path, because a path in a plan file is
 * a claim about the working tree and this section makes none.
 *
 * It takes no argument and returns the same text every call — the function shape
 * mirrors the writer's other fixed sections, so a reader comparing the sync
 * runner's two branches does not have to notice that one of them is not a call.
 */
export const decisionLogReference = (): string =>
	`## Decision Log

Composed by \`lightsout plan sync-decisions\`. Do not edit by hand. The complete
decision history for every phase of this plan is the log in overview.md, beside
this file.`;
