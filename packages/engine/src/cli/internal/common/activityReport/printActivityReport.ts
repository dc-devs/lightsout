import { formatCost, formatDuration } from '@lightsout/shared';
import { spanOfActivityNodes } from '#src/activity/common/utils/spanOfActivityNodes.ts';
import { totalActivityReports } from '#src/activity/totalActivityReports.ts';
import { harnessProcessLabel } from '#src/cli/internal/common/activityReport/harnessProcessLabel.ts';
import { renderActivityTree } from '#src/cli/internal/common/activityReport/renderActivityTree.ts';
import { printSectionHeading } from '#src/cli/internal/common/render/printSectionHeading.ts';
import { dim } from '#src/cli/internal/common/terminal/dim.ts';
import { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import type { ActivityNode } from '#src/contracts/activity/ActivityNode.ts';
import type { ActivityReport } from '#src/contracts/activity/ActivityReport.ts';
import type { HarnessProcessMark } from '#src/contracts/activity/HarnessProcessMark.ts';
import type { ConfigPricing } from '#src/contracts/ConfigPricing.ts';
import type { PlanActivityReport } from '#src/views/common/types/PlanActivityReport.ts';

interface Params {
	/** The --plan value as given, so the heading names what the reader asked for. */
	target: string;
	/** True when the value addressed a ticket folder rather than one plan. */
	workOrderFolder: boolean;
	plans: PlanActivityReport[];
	pricing?: ConfigPricing;
}

/** One harness process beside the label of the level it ran inside, which is what makes an outlier findable. */
interface RankedProcess {
	levelLabel: string;
	process: HarnessProcessMark;
	durationMs: number;
}

const rankedProcesses = ({ node }: { node: ActivityNode }): RankedProcess[] => [
	...node.processes.map((process) => ({
		levelLabel: node.label,
		process,
		durationMs: Date.parse(process.endedAt) - Date.parse(process.startedAt),
	})),
	...node.children.flatMap((child) => rankedProcesses({ node: child })),
];

const outlierLine = ({ levelLabel, process, durationMs }: RankedProcess) => {
	const named = [harnessProcessLabel({ process }), process.endReason];
	const cost = process.usage?.costUsd;

	return `  ${levelLabel}  ${dim('·')}  ${named.join(' · ')}  ${dim('·')}  ${formatDuration({ ms: durationMs })}${cost === undefined ? '' : `  ${dim('·')}  ${formatCost({ usd: cost })}`}`;
};

/**
 * The individual harness processes worth opening, whatever a plan's tree said
 * about its levels.
 *
 * The tree answers which level was slow; this answers which single call to
 * open, so the slowest few and the most expensive few are both here, listed
 * once each even when a call is both — a repeat of the same call under two
 * headings would only make the section longer than the answer.
 *
 * A record whose processes stated no cost at all says the cost ranking is
 * unavailable rather than ranking every call at zero: a harness that stated no
 * cost did not state a cost of nothing.
 */
const printOutliers = ({ plans }: { plans: PlanActivityReport[] }) => {
	const all = plans.flatMap((plan) => (plan.report === undefined ? [] : plan.report.roots.flatMap((node) => rankedProcesses({ node }))));

	if (all.length === 0) {
		return;
	}

	// Short enough to read, long enough that one unlucky call is not the whole answer.
	const outlierCount = 3;
	const priced = all.filter((ranked) => ranked.process.usage?.costUsd !== undefined);
	const slowest = [...all].sort((left, right) => right.durationMs - left.durationMs).slice(0, outlierCount);
	const costliest = [...priced].sort((left, right) => (right.process.usage?.costUsd ?? 0) - (left.process.usage?.costUsd ?? 0)).slice(0, outlierCount);
	const worthOpening = [...new Set([...slowest, ...costliest])].sort((left, right) => right.durationMs - left.durationMs);

	printSectionHeading({ title: 'Calls worth opening', subtitle: 'the slowest and most expensive individual harness processes' });

	for (const ranked of worthOpening) {
		console.log(outlierLine(ranked));
	}

	if (priced.length === 0) {
		console.log(dim('  most expensive: unavailable — no harness stated a cost'));
	}
};

/**
 * The ticket's own figures as one row above its plans.
 *
 * Drawn through the tree renderer rather than a second table, so the ticket row
 * and the plan rows beneath it are spelled and measured by one piece of code,
 * and its figures come from the shared ticket fold rather than from adding the
 * plan rows up — busy time is a union of intervals and peak concurrency is the
 * most processes alive at one instant across the whole ticket, and neither adds.
 */
const printTicketRow = ({ target, plans, pricing }: { target: string; plans: PlanActivityReport[]; pricing?: ConfigPricing }) => {
	const reports = plans.flatMap((plan) => (plan.report === undefined ? [] : [plan.report]));
	const roots = reports.flatMap((report) => report.roots);
	const row: ActivityNode = {
		id: target,
		level: ActivityLevelKind.Plan,
		label: target,
		// The same window the fold below was built from, so the row's times and
		// its figures can never have been measured across different spans.
		...spanOfActivityNodes({ nodes: roots }),
		processes: [],
		totals: totalActivityReports({ reports }),
		children: [],
	};
	const report: ActivityReport = { plan: target, roots: [row], totals: row.totals };

	for (const line of renderActivityTree({ report, pricing })) {
		console.log(line);
	}
};

/**
 * The whole printed answer for one `--plan` value.
 *
 * A plan folder written before the activity record existed holds none, so one
 * line saying so reads better than an empty table — and a ticket's missing plan
 * never stops the plans beside it from reporting.
 */
export const printActivityReport = ({ target, workOrderFolder, plans, pricing }: Params): void => {
	if (workOrderFolder) {
		printSectionHeading({ title: target, subtitle: `${plans.length} plans` });
		printTicketRow({ target, plans, pricing });
	}

	for (const plan of plans) {
		if (plan.report === undefined) {
			console.log('');
			console.log(dim(`${plan.name} — no activity record in this plan folder`));
			continue;
		}

		printSectionHeading({ title: plan.name });

		for (const line of renderActivityTree({ report: plan.report, pricing })) {
			console.log(line);
		}
	}

	printOutliers({ plans });
};
