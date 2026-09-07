/**
 * The statuses a jest assertion result can carry.
 *
 * Only `Passed` proves an acceptance-test row: every other status — a case that
 * was skipped, is pending, is a todo, was disabled, or failed — says the named
 * behaviour was not demonstrated by the run that just happened.
 */
export const TestCaseStatus = {
	Passed: 'passed',
	Failed: 'failed',
	Pending: 'pending',
	Skipped: 'skipped',
	Todo: 'todo',
	Disabled: 'disabled',
	Focused: 'focused',
} as const;

export type TestCaseStatus = (typeof TestCaseStatus)[keyof typeof TestCaseStatus];
