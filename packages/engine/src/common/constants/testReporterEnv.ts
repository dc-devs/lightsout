/**
 * The two environment variables the engine sets on every gate command so a jest
 * suite can hand back per-test results.
 *
 * One object because five places name them — the gate runner that sets them,
 * the doctor check that probes for them, the clean-slate message that explains
 * them, the reporter source that reads them, and this repository's own jest
 * factory — and a name typed five times is a name that goes wrong once.
 */
export const testReporterEnv = {
	/** Absolute path of the reporter file the engine wrote into the run folder. */
	reporter: 'LIGHTSOUT_JEST_REPORTER',
	/** Directory this gate execution's per-test results go in. */
	resultsDir: 'LIGHTSOUT_TEST_RESULTS_DIR',
} as const;
