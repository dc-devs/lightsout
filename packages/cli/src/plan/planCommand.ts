import { resolvePlansDir } from '@lightsout/engine';
import { getPositionals } from '../common/args/getPositionals';
import { getRequiredFlag } from '../common/args/getRequiredFlag';
import { getStringFlag } from '../common/args/getStringFlag';
import { usage } from '../common/constants/usage';
import type { CommandContext } from '../common/types/CommandContext';
import { resolveConfigAndDriver } from '../common/utils/resolveConfigAndDriver';
import { loadPlanningStandards } from './loadPlanningStandards';
import { planDedupCommand } from './planDedupCommand';
import { planDraftCommand } from './planDraftCommand';
import { planGradeCommand } from './planGradeCommand';
import { planLintCommand } from './planLintCommand';
import { planVerifyFactsCommand } from './planVerifyFactsCommand';

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
		const name = getRequiredFlag({ flags, name: 'name' });
		const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'plan' });
		const plansDir = resolvePlansDir({ cwd, flag: getStringFlag({ flags, name: 'plans' }), config });
		const standards = await loadPlanningStandards({ cwd, config });

		if (subcommand === 'draft') {
			await planDraftCommand({ cwd, driver, name, plansDir, standards, config, flags });
			return;
		}

		if (subcommand === 'dedup') {
			await planDedupCommand({ cwd, driver, name, plansDir, standards, config });
			return;
		}

		await planGradeCommand({ cwd, driver, name, plansDir, standards, config });
		return;
	}

	console.error(usage);
	process.exit(1);
};
