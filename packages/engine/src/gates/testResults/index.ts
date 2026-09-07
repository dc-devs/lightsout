// The evidence half of acceptance testing: which assertions a gate execution
// actually ran, and whether the tests a plan named are among them.
//
// `jestReporterSource` and `satisfiesGateKey` are deliberately absent. The
// reporter's source is only ever written to disk by `writeJestReporter`, and the
// gate-key translation is only ever asked by the two checks below — publishing
// either would invite a caller to re-implement half of a rule this module owns.
export { checkAcceptanceTests } from '#src/gates/testResults/checkAcceptanceTests.ts';
export { checkTestResultsCapability } from '#src/gates/testResults/checkTestResultsCapability.ts';
export { readTestResults } from '#src/gates/testResults/readTestResults.ts';
export { testResultsDir } from '#src/gates/testResults/testResultsDir.ts';
export { writeJestReporter } from '#src/gates/testResults/writeJestReporter.ts';
