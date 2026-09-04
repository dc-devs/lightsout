export interface GateEntry {
	/** The gate's family: the key `failedFamilies` reports and the `kind` the runner records — 'check', 'test', 'testCoverage', 'build', or a custom suite's own name. */
	family: string;
	/** The config's own spelling, used in the failure text and matched against a `gate-overrides` list: 'check', 'test', 'test-coverage', 'build', 'test-e2e', … */
	name: string;
	/**
	 * The shell command as the block that declared it wrote it. For a root
	 * group that is the final command; for a scoped group it is still the
	 * `{package}` template, which `runPackageGates` resolves per package
	 * before the entry reaches `runGateSet`. Selection happens on `name`, so
	 * the schedule never reads this field and never cares which of the two it
	 * holds.
	 */
	command: string;
}
