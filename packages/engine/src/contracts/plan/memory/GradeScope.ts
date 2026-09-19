/**
 * How far one recorded grading pass reached. It is a statement about this pass
 * and nothing else: approval is decided from what the read-coverage record
 * covers and from whether every finding is closed, never from this field, so a
 * focused pass may well be the pass that approves a plan.
 */
export const GradeScope = {
	/** Every plan file the deliverable holds was offered to the readers. */
	Full: 'full',
	/** Only the plan files whose coverage did not stand were read — the edited phases, what they reach, and whatever else lost its recorded reading. */
	Focused: 'focused',
} as const;

export type GradeScope = (typeof GradeScope)[keyof typeof GradeScope];
