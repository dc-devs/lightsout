import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { usage } from '@/cli/common/constants/usage';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { doctorCommand } from '@/cli/doctorCommand';
import { frictionCommand } from '@/cli/frictionCommand';
import { implementCommand } from '@/cli/implementCommand';
import { improveCommand } from '@/cli/improveCommand';
import { planCommand } from '@/cli/plan';
import { resumeCommand } from '@/cli/resumeCommand';
import { refactorCommand } from '@/cli/refactorCommand';
import { standardsCheckCommand } from '@/cli/standardsCheckCommand';
import { standardsHealthCommand } from '@/cli/standardsHealthCommand';
import { standardsValidateCommand } from '@/cli/standardsValidateCommand';
import { statusCommand } from '@/cli/statusCommand';
import { voiceCommand } from '@/cli/voice';

const commands: Record<string, (context: CommandContext) => Promise<void>> = {
	implement: implementCommand,
	resume: resumeCommand,
	status: statusCommand,
	doctor: doctorCommand,
	'standards-check': standardsCheckCommand,
	'standards-validate': standardsValidateCommand,
	'standards-health': standardsHealthCommand,
	refactor: refactorCommand,
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
	process.exit(command === undefined || command === 'help' ? 0 : 1);
};

await main();
