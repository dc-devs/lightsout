export const StandardsSeverity = {
	/** A violation that stops a run when it touches a file that run changed. */
	Blocking: 'blocking',
	/** Worth a look, plausibly intentional — reported and judged, never blocking. */
	Advisory: 'advisory',
	/**
	 * Not run. Set by a repo when its own linter already enforces the rule — the
	 * only way a rule stops blocking — or shipped by a pack for a rule a repo
	 * opts into. An opt-in rule a repo never names is not part of its standards
	 * at all, prose included.
	 */
	Off: 'off',
} as const;

export type StandardsSeverity = (typeof StandardsSeverity)[keyof typeof StandardsSeverity];
