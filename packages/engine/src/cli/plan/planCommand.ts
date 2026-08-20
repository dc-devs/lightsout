import { getPositionals } from '#src/cli/common/args/getPositionals.ts';
import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveConfigAndDriver } from '#src/cli/common/utils/resolveConfigAndDriver.ts';
import { loadPlanningStandards } from '#src/cli/plan/loadPlanningStandards.ts';
import { planDedupCommand } from '#src/cli/plan/planDedupCommand.ts';
import { planDraftCommand } from '#src/cli/plan/planDraftCommand.ts';
import { planGradeCommand } from '#src/cli/plan/planGradeCommand.ts';
import { planLintCommand } from '#src/cli/plan/planLintCommand.ts';
import { planVerifyFactsCommand } from '#src/cli/plan/planVerifyFactsCommand.ts';

export const planCommand = async ({ flags, rest, cwd }: CommandContext): Promise<void> => {
	const subcommand = getPositionals({ args: rest })[0];

	// verify-facts is deterministic — no agent, so no resolveConfigAndDriver.
	if (subcommand === 'verify-facts') {
		await planVerifyFactsCommand({ flags, rest, cwd });
		return;
	}

	// lint is deterministic — no agent, so no resolveConfigAndDriver.
	if (subcommand === 'lint') {
		await planLintCommand({ flags, rest, cwd });
		return;
	}

	if (subcommand === 'draft' || subcommand === 'dedup' || subcommand === 'grade') {
		const name = await getRequiredFlag({ flags, name: 'name' });
		const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'plan' });
		const standards = await loadPlanningStandards({ cwd, config });

		if (subcommand === 'draft') {
			await planDraftCommand({ cwd, driver, name, standards, config, flags });
			return;
		}

		if (subcommand === 'dedup') {
			await planDedupCommand({ cwd, driver, name, standards, config });
			return;
		}

		await planGradeCommand({ cwd, driver, name, standards, config });
		return;
	}

	console.error(usage);
	return exitCli({ code: 1 });
};
