import { getListFlag } from '#src/cli/common/args/getListFlag.ts';
import { getPositionals } from '#src/cli/common/args/getPositionals.ts';
import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveConfigAndDriver } from '#src/cli/common/utils/resolveConfigAndDriver.ts';
import { planDedupCommand } from '#src/cli/plan/planDedupCommand.ts';
import { planDraftCommand } from '#src/cli/plan/planDraftCommand.ts';
import { planGradeCommand } from '#src/cli/plan/planGradeCommand.ts';
import { planLintCommand } from '#src/cli/plan/planLintCommand.ts';
import { planVerifyFactsCommand } from '#src/cli/plan/planVerifyFactsCommand.ts';
import { readPlanningStandards } from '#src/cli/plan/readPlanningStandards.ts';

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
		const standards = await readPlanningStandards({ cwd, config });

		if (subcommand === 'draft') {
			await planDraftCommand({ cwd, driver, name, standards, config, flags });
			return;
		}

		if (subcommand === 'dedup') {
			await planDedupCommand({ cwd, driver, name, standards, config });
			return;
		}

		// A `--phase` present but yielding no values reaches the runner as an empty
		// list, which it refuses — the "graded less than you asked and said
		// nothing" failure this work exists to remove.
		const phases = getListFlag({ flags, name: 'phase' });

		await planGradeCommand({ cwd, driver, name, standards, config, phases });
		return;
	}

	console.error(usage);
	return exitCli({ code: 1 });
};
