import { getPositionals } from '@/cli/common/args/getPositionals';
import { usage } from '@/cli/common/constants/usage';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { exitCli } from '@/cli/common/utils/exitCli';
import { getStreamText } from '@/cli/voice/common/utils/getStreamText';
import { voiceHookCommand } from '@/cli/voice/voiceHookCommand';
import { voiceOffCommand } from '@/cli/voice/voiceOffCommand';
import { voiceOnCommand } from '@/cli/voice/voiceOnCommand';

export const voiceCommand = async ({ rest, cwd }: CommandContext): Promise<void> => {
	const subcommand = getPositionals({ args: rest })[0];

	if (subcommand === 'on') {
		await voiceOnCommand({ cwd });
		return;
	}

	if (subcommand === 'off') {
		await voiceOffCommand({ cwd });
		return;
	}

	if (subcommand === 'hook') {
		// A hook context always pipes its payload in. Run by hand in a terminal
		// there is no payload coming, and waiting on a keyboard would hang forever.
		const input = process.stdin.isTTY ? '' : await getStreamText({ stream: process.stdin });

		await voiceHookCommand({ cwd, input });
		return;
	}

	console.error(usage);
	return exitCli({ code: 1 });
};
