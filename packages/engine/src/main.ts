import type { CommandContext } from '#src/cli/index.ts';
import {
	doctorCommand,
	exitCli,
	frictionCommand,
	getStringFlag,
	implementCommand,
	improveCommand,
	parseFlags,
	planCommand,
	refactorCommand,
	resumeCommand,
	standardsCheckCommand,
	standardsHealthCommand,
	standardsValidateCommand,
	statusCommand,
	testCoverageToThresholdCommand,
	usage,
	voiceCommand,
} from '#src/cli/index.ts';

const commands: Record<string, (context: CommandContext) => Promise<void>> = {
	implement: implementCommand,
	resume: resumeCommand,
	status: statusCommand,
	doctor: doctorCommand,
	'standards-check': standardsCheckCommand,
	'standards-validate': standardsValidateCommand,
	'standards-health': standardsHealthCommand,
	refactor: refactorCommand,
	'test-coverage-to-threshold': testCoverageToThresholdCommand,
	plan: planCommand,
	friction: frictionCommand,
	improve: improveCommand,
	voice: voiceCommand,
};

const main = async (): Promise<void> => {
	const [command, ...rest] = process.argv.slice(2);
	const flags = parseFlags({ args: rest });
	const cwd = getStringFlag({ flags, name: 'cwd' }) ?? process.cwd();
	const run = command === undefined ? undefined : commands[command];

	if (run) {
		await run({ flags, rest, cwd });
		return;
	}

	console.error(usage);
	return exitCli({ code: command === undefined || command === 'help' ? 0 : 1 });
};

await main();
