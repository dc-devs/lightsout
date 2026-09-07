import type { resolveGates } from '#src/common/config/resolveGates.ts';
import type { GateCommands } from '#src/gates/common/types/GateCommands.ts';

interface Params {
	gates: ReturnType<typeof resolveGates>;
}

/** The root group's commands, the coverage one included whenever the config configures it — `buildGateStages` is what decides whether it is scheduled. */
export const rootGateCommands = ({ gates }: Params): GateCommands => ({
	check: gates.check,
	test: gates.test,
	testCoverage: typeof gates.testCoverage === 'string' ? gates.testCoverage : undefined,
	extraTests: gates.extraTests,
	build: gates.build,
});
