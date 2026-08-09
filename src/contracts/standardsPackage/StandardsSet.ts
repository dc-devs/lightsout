export const StandardsSet = {
	/** The document tree handed to code-writing roles. */
	Code: 'code',
	/** The document tree handed to the test-writing role. */
	Tests: 'tests',
} as const;

export type StandardsSet = (typeof StandardsSet)[keyof typeof StandardsSet];
