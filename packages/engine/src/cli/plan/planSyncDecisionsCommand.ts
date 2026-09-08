import { basename } from 'node:path';
import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { PlanRunStatus, syncPlanDecisions } from '#src/plan/index.ts';

export const planSyncDecisionsCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const name = await getRequiredFlag({ flags, name: 'name' });
	const result = await syncPlanDecisions({ cwd, name });

	if (result.status === PlanRunStatus.Failed) {
		console.error(`\n${result.error}`);
		return exitCli({ code: 1 });
	}

	console.log(`\n${bold(`plan sync-decisions ${name}`)} — ${result.files.length} file(s)`);

	// One line per plan file, updated or not: a human running this needs to see
	// what moved, and a repeated run that moved nothing has to say so.
	for (const file of result.files) {
		console.log(`  ${basename(file.path)} — ${file.updated ? 'updated' : 'unchanged'}`);
	}

	return exitCli({ code: 0 });
};
