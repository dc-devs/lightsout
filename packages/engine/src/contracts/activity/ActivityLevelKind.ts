/**
 * The four nesting levels an activity record may hold.
 *
 * Four members and no fifth: a drafting fan-out and a grading repair round are
 * both `Pass` levels told apart by their label, which is what keeps the
 * vocabulary free of any one pipeline's words. A record written by planning and
 * one written by implementation then share a shape rather than competing.
 */
export const ActivityLevelKind = {
	/** The whole plan folder — every command run inside it folds under one of these. */
	Plan: 'plan',
	/** One invocation of a command, start to exit. */
	CommandRun: 'command-run',
	/** A grouping inside a command run: a grading pass, a drafting fan-out, a repair round. */
	Pass: 'pass',
	/** One named step — the level a harness process runs inside. */
	Step: 'step',
} as const;

export type ActivityLevelKind = (typeof ActivityLevelKind)[keyof typeof ActivityLevelKind];
