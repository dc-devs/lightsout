import { brainstormCommand } from '#src/cli/brainstorm/brainstormCommand.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { getUnknownFlagsMessage } from '#src/cli/common/args/getUnknownFlagsMessage.ts';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { loadRepoEnvFile } from '#src/cli/common/utils/loadRepoEnvFile.ts';
import { doctorCommand } from '#src/cli/doctorCommand.ts';
import { frictionCommand } from '#src/cli/frictionCommand.ts';
import { implementCommand } from '#src/cli/implementCommand.ts';
import { implementDirectCommand } from '#src/cli/implementDirectCommand.ts';
import { improveCommand } from '#src/cli/improveCommand.ts';
import { planCommand } from '#src/cli/plan/planCommand.ts';
import { queueCommand } from '#src/cli/queueCommand.ts';
import { refactorCommand } from '#src/cli/refactorCommand.ts';
import { reportCommand } from '#src/cli/reportCommand.ts';
import { resumeCommand } from '#src/cli/resumeCommand.ts';
import { selfCheckCommand } from '#src/cli/selfCheckCommand.ts';
import { shipCommand } from '#src/cli/shipCommand.ts';
import { standardsCheckCommand } from '#src/cli/standardsCheckCommand.ts';
import { standardsHealthCommand } from '#src/cli/standardsHealthCommand.ts';
import { standardsValidateCommand } from '#src/cli/standardsValidateCommand.ts';
import { statusCommand } from '#src/cli/statusCommand.ts';
import { testCoverageToThresholdCommand } from '#src/cli/testCoverageToThresholdCommand.ts';
import { ticketStateCommand } from '#src/cli/ticketStateCommand.ts';
import { voiceCommand } from '#src/cli/voice/voiceCommand.ts';
import { workOrderCommand } from '#src/cli/workOrder/workOrderCommand.ts';

const commands: Record<string, (context: CommandContext) => Promise<void>> = {
	implement: implementCommand,
	'implement-direct': implementDirectCommand,
	queue: queueCommand,
	resume: resumeCommand,
	ship: shipCommand,
	'self-check': selfCheckCommand,
	'ticket-state': ticketStateCommand,
	'work-order': workOrderCommand,
	status: statusCommand,
	doctor: doctorCommand,
	report: reportCommand,
	'standards-check': standardsCheckCommand,
	'standards-validate': standardsValidateCommand,
	'standards-health': standardsHealthCommand,
	refactor: refactorCommand,
	'test-coverage-to-threshold': testCoverageToThresholdCommand,
	plan: planCommand,
	brainstorm: brainstormCommand,
	friction: frictionCommand,
	improve: improveCommand,
	voice: voiceCommand,
};

const main = async (): Promise<void> => {
	const [command, ...rest] = process.argv.slice(2);
	const flags = parseFlags({ args: rest });
	const cwd = getStringFlag({ flags, name: 'cwd' }) ?? process.cwd();

	// Before any command reads the environment, so the repository's own `.env`
	// answers for the tracker key rather than every caller having to export it.
	await loadRepoEnvFile({ cwd });

	const run = command === undefined ? undefined : commands[command];
	const problem = command === undefined || run === undefined ? undefined : getUnknownFlagsMessage({ command, flags });

	if (run && problem === undefined) {
		await run({ flags, rest, cwd });
		return;
	}

	console.error(problem === undefined ? usage : `${problem}\n\n${usage}`);
	return exitCli({ code: command === undefined || command === 'help' ? 0 : 1 });
};

await main();
