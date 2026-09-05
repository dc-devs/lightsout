import type { CommandContext } from '#src/cli/index.ts';
import {
	brainstormCommand,
	doctorCommand,
	exitCli,
	frictionCommand,
	getStringFlag,
	getUnknownFlagsMessage,
	implementCommand,
	implementDirectCommand,
	improveCommand,
	loadRepoEnvFile,
	parseFlags,
	planCommand,
	queueCommand,
	refactorCommand,
	resumeCommand,
	shipCommand,
	standardsCheckCommand,
	standardsHealthCommand,
	standardsValidateCommand,
	statusCommand,
	testCoverageToThresholdCommand,
	ticketStateCommand,
	usage,
	voiceCommand,
} from '#src/cli/index.ts';

const commands: Record<string, (context: CommandContext) => Promise<void>> = {
	implement: implementCommand,
	'implement-direct': implementDirectCommand,
	queue: queueCommand,
	resume: resumeCommand,
	ship: shipCommand,
	'ticket-state': ticketStateCommand,
	status: statusCommand,
	doctor: doctorCommand,
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
	loadRepoEnvFile({ cwd });

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
