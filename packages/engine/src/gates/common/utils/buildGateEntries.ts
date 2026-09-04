import type { GateCommands } from '#src/gates/common/types/GateCommands.ts';
import type { GateEntry } from '#src/gates/common/types/GateEntry.ts';

interface Params {
	/** One group's commands as its block wrote them — the root block's finished commands, or a scoped block's `{package}` templates. */
	commands: GateCommands;
}

/**
 * A group's configured commands as an ordered entry list, in the engine's
 * canonical order: check, the unit suite plain then instrumented, each custom
 * suite in the order the config wrote it, then build.
 *
 * No substitution and no selection happens here — every command the block
 * configured gets an entry, and `buildGateStages` decides which of them a run
 * actually schedules.
 */
export const buildGateEntries = ({ commands }: Params): GateEntry[] => {
	const declared = [
		{ family: 'check', name: 'check', command: commands.check },
		{ family: 'test', name: 'test', command: commands.test },
		{ family: 'testCoverage', name: 'test-coverage', command: commands.testCoverage },
		...(commands.extraTests ?? []).map(({ name, command }) => ({ family: name, name, command })),
		{ family: 'build', name: 'build', command: commands.build },
	];

	return declared.flatMap(({ family, name, command }) => (command === undefined ? [] : [{ family, name, command }]));
};
