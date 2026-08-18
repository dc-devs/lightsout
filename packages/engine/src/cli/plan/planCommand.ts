import { getPositionals } from '@/cli/common/args/getPositionals';
import { getRequiredFlag } from '@/cli/common/args/getRequiredFlag';
import { usage } from '@/cli/common/constants/usage';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { exitCli } from '@/cli/common/utils/exitCli';
import { resolveConfigAndDriver } from '@/cli/common/utils/resolveConfigAndDriver';
import { loadPlanningStandards } from '@/cli/plan/loadPlanningStandards';
import { planDedupCommand } from '@/cli/plan/planDedupCommand';
import { planDraftCommand } from '@/cli/plan/planDraftCommand';
import { planGradeCommand } from '@/cli/plan/planGradeCommand';
import { planLintCommand } from '@/cli/plan/planLintCommand';
import { planVerifyFactsCommand } from '@/cli/plan/planVerifyFactsCommand';

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
