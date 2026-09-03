import { getPositionals } from '#src/cli/common/args/getPositionals.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { getStreamText } from '#src/cli/voice/common/utils/getStreamText.ts';
import { voiceHookCommand } from '#src/cli/voice/voiceHookCommand.ts';
import { voiceOffCommand } from '#src/cli/voice/voiceOffCommand.ts';
import { voiceOnCommand } from '#src/cli/voice/voiceOnCommand.ts';
import { voiceSpeakCommand } from '#src/cli/voice/voiceSpeakCommand.ts';

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

	if (subcommand === 'speak') {
		// A pi-family extension pipes its payload in the same way; the first
		// positional names which event it describes.
		const kind = getPositionals({ args: rest })[1];

		if (kind !== 'turn' && kind !== 'picker') {
			console.error(usage);
			return exitCli({ code: 1 });
		}

		const input = process.stdin.isTTY ? '' : await getStreamText({ stream: process.stdin });

		await voiceSpeakCommand({ cwd, kind, input });
		return;
	}

	console.error(usage);
	return exitCli({ code: 1 });
};
