/**
 * One acceptance test a verification checkpoint must prove.
 *
 * Three fields and no more, so the plan's parsed ledger rows and the manifest's
 * acceptance-test records both satisfy it without a conversion at either call
 * site — the plan threads it from `buildSteps` through `verifyStep` and
 * `runVerificationGates` to `checkAcceptanceTests`, and every hop reads the
 * same shape.
 */
export interface AcceptanceRow {
	/** Repo-relative path of the test file stating the criterion. */
	testFile: string;
	/** The test's title, as the file states it and as the runner reports it. */
	testName: string;
	/** The config's own gate key whose execution must carry the result. */
	gate: string;
}
