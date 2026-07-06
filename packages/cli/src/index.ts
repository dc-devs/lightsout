import { getStringFlag } from './common/args/getStringFlag';
import { parseFlags } from './common/args/parseFlags';
import { usage } from './common/constants/usage';
import type { CommandContext } from './common/types/CommandContext';
import { buildMapCommand } from './buildMapCommand';
import { debugCommand } from './debugCommand';
import { doctorCommand } from './doctorCommand';
import { frictionCommand } from './frictionCommand';
import { implementCommand } from './implementCommand';
import { improveCommand } from './improveCommand';
import { mapConnectionCommand } from './mapConnectionCommand';
import { planCommand } from './plan';
import { resumeCommand } from './resumeCommand';
import { scanCommand } from './scanCommand';
import { statusCommand } from './statusCommand';
import { traverseCommand } from './traverseCommand';

const commands: Record<string, (context: CommandContext) => Promise<void>> = {
	implement: implementCommand,
	resume: resumeCommand,
	status: statusCommand,
	doctor: doctorCommand,
	scan: scanCommand,
	traverse: traverseCommand,
	debug: debugCommand,
	'build-map': buildMapCommand,
	'map-connection': mapConnectionCommand,
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
