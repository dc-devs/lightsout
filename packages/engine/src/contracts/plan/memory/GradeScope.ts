/**
 * How far one recorded grading pass reached. The verdict turns on it: approval
 * needs a review of the whole plan, so a focused repair check can never be the
 * pass that grants it.
 */
export const GradeScope = {
	/** Every plan file the deliverable holds was offered to the readers. Only a full pass may be `passed`. */
	Full: 'full',
	/** Only the edited phases and their connected closure were read. Never `passed`. */
	Focused: 'focused',
} as const;

export type GradeScope = (typeof GradeScope)[keyof typeof GradeScope];
