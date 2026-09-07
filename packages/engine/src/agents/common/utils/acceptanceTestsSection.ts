import type { AcceptanceTestRecord } from '#src/contracts/index.ts';

interface Params {
	/** The run's acceptance-test mapping, each row a test file and the name of the case in it. */
	acceptanceTests?: Pick<AcceptanceTestRecord, 'testFile' | 'testName'>[];
}

/**
 * The brief section naming the tests that define done, and the rules binding
 * anyone who edits one.
 *
 * One text, shared by the executor's brief and the unit-test writer's, because
 * the rules bind both identically: a second spelling in one of them would be a
 * second set of rules the moment either is edited.
 *
 * @returns the section, or undefined for a run whose plan names no acceptance test — the section is omitted rather than emitted empty.
 */
export const acceptanceTestsSection = ({ acceptanceTests }: Params): string | undefined => {
	if (acceptanceTests === undefined || acceptanceTests.length === 0) {
		return undefined;
	}

	return [
		'# Acceptance tests',
		'',
		"These state the plan's acceptance criteria — what this run means by done:",
		'',
		...acceptanceTests.map(({ testFile, testName }) => `- \`${testName}\` in ${testFile}`),
		'',
		'- Every one of them must execute and pass before the work is done.',
		"- A test file may be edited when the plan's own changes make it stale — an import, a mock, a fixture, setup, or a move.",
		'- Every edit to a test file is reviewed against the plan before any gate runs.',
		'- The review refuses a weakened or removed assertion, an acceptance test deleted, renamed, skipped or replaced without a disposition the plan backs, a mock that neuters the subject under test, a snapshot rewrite that hides a behaviour change the plan did not authorise, and configuration that stops a test from being collected.',
		'- A moved test file carries every case its source held.',
	].join('\n');
};
