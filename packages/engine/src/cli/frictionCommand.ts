import type { CommandContext } from '@/cli/common/types/CommandContext';
import { exitCli } from '@/cli/common/utils/exitCli';
import { readFriction } from '@/runState';

export const frictionCommand = async ({ cwd }: CommandContext): Promise<void> => {
	const entries = await readFriction({ cwd });

	if (entries.length === 0) {
		console.log('no friction recorded');
		return exitCli({ code: 0 });
	}

	for (const entry of entries) {
		console.log(`[${entry.area}] (run ${entry.runId.slice(0, 8)}, ${entry.step}, ${entry.at}) ${entry.detail}`);
	}

	return exitCli({ code: 0 });
};
