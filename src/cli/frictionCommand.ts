import { readFriction } from '@/runState';
import type { CommandContext } from '@/cli/common/types/CommandContext';

export const frictionCommand = async ({ cwd }: CommandContext): Promise<void> => {
	const entries = await readFriction({ cwd });

	if (entries.length === 0) {
		console.log('no friction recorded');
		process.exit(0);
	}

	for (const entry of entries) {
		console.log(`[${entry.area}] (run ${entry.runId.slice(0, 8)}, ${entry.step}, ${entry.at}) ${entry.detail}`);
	}

	process.exit(0);
};
