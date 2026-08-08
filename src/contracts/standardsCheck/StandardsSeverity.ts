export const StandardsSeverity = {
	/** A rule violation — blocks a run when it touches a file that run changed. */
	Finding: 'finding',
	/** Worth a look, plausibly intentional — reported and judged, never blocking. */
	Advisory: 'advisory',
	/** Not run. What a repo sets when its own linter already enforces the rule — the only way a rule stops blocking. */
	Off: 'off',
} as const;

export type StandardsSeverity = (typeof StandardsSeverity)[keyof typeof StandardsSeverity];
