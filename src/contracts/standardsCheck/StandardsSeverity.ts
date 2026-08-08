export const StandardsSeverity = {
	/** A rule violation — v2 remediation acts on these. */
	Finding: 'finding',
	/** Worth a look, plausibly intentional — never auto-remediated. */
	Advisory: 'advisory',
} as const;

export type StandardsSeverity = (typeof StandardsSeverity)[keyof typeof StandardsSeverity];
