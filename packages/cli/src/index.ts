import { getStringFlag } from './common/args/getStringFlag';
import { parseFlags } from './common/args/parseFlags';
import { usage } from './common/constants/usage';
import type { CommandContext } from './common/types/CommandContext';
import { doctorCommand } from './doctorCommand';
import { frictionCommand } from './frictionCommand';
import { implementCommand } from './implementCommand';
import { improveCommand } from './improveCommand';
import { planCommand } from './plan';
import { resumeCommand } from './resumeCommand';
import { refactorCommand } from './refactorCommand';
import { scanCommand } from './scanCommand';
import { statusCommand } from './statusCommand';

const commands: Record<string, (context: CommandContext) => Promise<void>> = {
	implement: implementCommand,
	resume: resumeCommand,
	status: statusCommand,
	doctor: doctorCommand,
	scan: scanCommand,
	refactor: refactorCommand,
	plan: planCommand,
	friction: frictionCommand,
	improve: improveCommand,
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
	process.exit(command === undefined || command === 'help' ? 0 : 1);
};

await main();
