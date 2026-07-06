import { getDriver } from '@lightsout/drivers';
import { loadConfig, resolvePlansDir } from '@lightsout/engine';
import { getPositionals } from '../common/args/getPositionals';
import { getStringFlag } from '../common/args/getStringFlag';
import { usage } from '../common/constants/usage';
import type { CommandContext } from '../common/types/CommandContext';
import { loadPlanningStandards } from './loadPlanningStandards';
import { planDedupCommand } from './planDedupCommand';
import { planDraftCommand } from './planDraftCommand';
import { planExploreCommand } from './planExploreCommand';
import { planGradeCommand } from './planGradeCommand';

export const planCommand = async ({ flags, rest, cwd }: CommandContext): Promise<void> => {
	const subcommand = getPositionals({ args: rest })[0];

	if (subcommand === 'explore') {
		await planExploreCommand({ flags, rest, cwd });
		return;
	}

	if (subcommand === 'draft' || subcommand === 'dedup' || subcommand === 'grade') {
		const name = getStringFlag({ flags, name: 'name' });

		if (!name) {
			console.error(usage);
			process.exit(1);
		}

		const config = await loadConfig({ cwd }).catch(() => undefined);
		const driver = getDriver({ name: config?.driver ?? 'claude-code' });
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
