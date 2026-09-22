import { estimateActivityCost } from '#src/activity/index.ts';
import { printActivityReport } from '#src/cli/common/activityReport/printActivityReport.ts';
import { resolveReportTargets } from '#src/cli/common/activityReport/resolveReportTargets.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';
import type { ConfigPricing } from '#src/contracts/index.ts';
import { type PlanActivityReport, readPlanActivityReports } from '#src/views/index.ts';

/**
 * One plan's estimate for the data payload: every root priced and added.
 *
 * Absent whenever the shared estimator answered nothing for every root, so a
 * repository with no rates for the models a plan ran under carries no estimate
 * rather than a zero.
 */
const estimateOf = ({ plan, pricing }: { plan: PlanActivityReport; pricing?: ConfigPricing }) => {
	const priced = (plan.report?.roots ?? []).flatMap((node) => {
		const estimate = estimateActivityCost({ node, pricing });

		return estimate === undefined ? [] : [estimate];
	});

	return priced.length === 0 ? undefined : priced.reduce((total, dollars) => total + dollars, 0);
};

/**
 * `lightsout report --plan <name>` — where a plan's hours and money went.
 *
 * It spawns nothing and writes nothing: every figure it prints was recorded by
 * the plan commands that spent the time, and everything above a harness process
 * is folded from those marks when they are read. The name may address one plan,
 * a legacy plan folder, or a ticket folder holding several plans.
 *
 * `--json` prints the same totalled tree as data and no table, so a later chart
 * reads the one calculation this table reads rather than a second one of its
 * own. The payload carries the tree rather than any pre-formatted string, which
 * is the whole point of the flag.
 *
 * The repository's config is optional: a repository with none still gets a
 * report and loses only the estimated-cost column, because a report is never
 * withheld for want of a price list.
 */
export const reportCommand = async ({ cwd, flags }: CommandContext): Promise<void> => {
	const name = getStringFlag({ flags, name: 'plan' });

	if (name === undefined) {
		// No plan is named, so there is no plan to default to — a report of some
		// other plan would answer a question nobody asked.
		console.error(usage);
		return exitCli({ code: 1 });
	}

	const resolved = await resolveReportTargets({ cwd, name });

	if ('error' in resolved) {
		console.error(resolved.error);
		return exitCli({ code: 1 });
	}

	const pricing = (await readOptionalConfig({ cwd }))?.pricing;
	const plans = await readPlanActivityReports({ cwd, names: resolved.names });

	if (flags.get('json') === true) {
		console.log(
			JSON.stringify(
				{
					target: name,
					workOrderFolder: resolved.workOrderFolder,
					plans: plans.map((plan) => ({ name: plan.name, report: plan.report, estimatedCostUsd: estimateOf({ plan, pricing }) })),
				},
				null,
				2,
			),
		);

		return exitCli({ code: 0 });
	}

	printActivityReport({ target: name, workOrderFolder: resolved.workOrderFolder, plans, pricing });

	return exitCli({ code: 0 });
};
