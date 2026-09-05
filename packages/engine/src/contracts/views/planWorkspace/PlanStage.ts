/**
 * How far a plan workspace has got.
 *
 * Derived from which files exist and whether a passed run names one of them,
 * never stored: nothing writes a stage today, and a written one would have to
 * be remembered by every command that touches a workspace. A derived stage
 * cannot go stale.
 */
export const PlanStage = {
	/** A workspace with no notes and no drafted plan yet — facts, decisions or transcripts only. */
	Started: 'started',
	/** `brainstorm-notes.md` exists and nothing has been drafted. */
	NotesOnly: 'notes-only',
	Drafted: 'drafted',
	Graded: 'graded',
	Implemented: 'implemented',
} as const;

export type PlanStage = (typeof PlanStage)[keyof typeof PlanStage];
