/** A kind left undefined is not run — scoped groups skip kinds the package has no script for. */
export interface GateCommands {
	check?: string;
	test?: string;
	testCoverage?: string;
	/** Custom `test-*` suites, run in this order after the unit suite and before build. A skipped scoped suite carries no command. */
	extraTests?: { name: string; command?: string }[];
	build?: string;
}
