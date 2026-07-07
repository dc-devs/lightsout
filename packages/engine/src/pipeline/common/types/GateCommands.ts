/** A kind left undefined is not run — scoped groups skip kinds the package has no script for. */
export interface GateCommands {
	check?: string;
	testUnit?: string;
	testCoverage?: string;
	build?: string;
}
