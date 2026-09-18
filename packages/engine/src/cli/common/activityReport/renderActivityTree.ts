import { formatCost, formatDuration, formatTokenCount } from '@lightsout/shared';
import { estimateActivityCost } from '#src/activity/index.ts';
import { harnessProcessLabel } from '#src/cli/common/activityReport/harnessProcessLabel.ts';
import { renderTable } from '#src/cli/common/render/renderTable.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';
import {
	ActivityLevelKind,
	type ActivityNode,
	type ActivityReport,
	type ConfigPricing,
	type HarnessProcessMark,
	type HarnessProcessUsage,
} from '#src/contracts/index.ts';

interface Params {
	report: ActivityReport;
	pricing?: ConfigPricing;
}

/**
 * One row as `renderTable` takes it, derived from that function rather than
 * restated — a hand-copied shape would be a second contract able to drift from
 * the first.
 */
type Row = Parameters<typeof renderTable>[0]['rows'][number];

/** The one spelling of "not reported", taken from `formatDuration`'s own placeholder. */
const notReported = '—';

/**
 * Wall time and agent time are separate columns and are never added together or
 * swapped: up to twelve grading agents and eight drafting agents run at once, so
 * a level's summed agent time routinely exceeds its own wall time, and `peak` is
 * what makes that gap self-explaining rather than something a reader has to
 * infer.
 *
 * Cache reads and cache writes share one column for width; `--json` carries all
 * four counts separately, so an estimate stays checkable from the data.
 */
const baseHeaders = ['level', 'wall', 'agent', 'peak', 'share', 'in', 'out', 'cache', 'cost'];

const indentOf = ({ depth }: { depth: number }) => '  '.repeat(depth);

const tokenCell = ({ count }: { count?: number }) => (count === undefined ? notReported : formatTokenCount({ count }));

const costCell = ({ usd }: { usd?: number }) => (usd === undefined ? notReported : formatCost({ usd }));

/** The two cache counts as one figure, absent only when neither was reported. */
const cacheTokens = ({ usage }: { usage: HarnessProcessUsage }) => {
	const reported = [usage.cacheReadTokens, usage.cacheCreationTokens].flatMap((count) => (count === undefined ? [] : [count]));

	return reported.length === 0 ? undefined : reported.reduce((total, count) => total + count, 0);
};

const usageCells = ({ usage }: { usage?: HarnessProcessUsage }) => [
	tokenCell({ count: usage?.inputTokens }),
	tokenCell({ count: usage?.outputTokens }),
	tokenCell({ count: usage === undefined ? undefined : cacheTokens({ usage }) }),
	costCell({ usd: usage?.costUsd }),
];

const estimateCells = ({ node, pricing }: { node: ActivityNode; pricing?: ConfigPricing }) =>
	pricing === undefined ? [] : [costCell({ usd: estimateActivityCost({ node, pricing }) })];

/** A share divides the parent's agent time, so a level's children add to one hundred percent. */
const shareCell = ({ ms, ofMs }: { ms: number; ofMs?: number }) => (ofMs === undefined || ofMs === 0 ? notReported : `${((ms / ofMs) * 100).toFixed(1)}%`);

/** The clock a reader would have seen, in their own timezone — hours and minutes, because seconds are in the duration column. */
const clockOf = ({ at }: { at: string }) => {
	const when = new Date(at);

	return `${when.getHours()}:${String(when.getMinutes()).padStart(2, '0')}`;
};

/**
 * A plan row's engine time: its command runs' wall times added up.
 *
 * It is neither the plan's own elapsed time nor the time its agents spent. A
 * plan is several separate commands a person starts by hand, so the hours
 * between them belong to nobody — which is what makes the gap between this
 * figure and the elapsed time a finding rather than an error. A plan level with
 * no command run recorded beneath it has none to add, so its own agent time is
 * the only honest figure it can show.
 */
const engineMs = ({ node }: { node: ActivityNode }) => {
	const runs = node.children
		.filter((child) => child.level === ActivityLevelKind.CommandRun)
		.flatMap((child) => (child.totals.wallMs === undefined ? [] : [child.totals.wallMs]));

	return runs.length === 0 ? node.totals.agentMs : runs.reduce((total, ms) => total + ms, 0);
};

const agentMsOf = ({ node }: { node: ActivityNode }) => (node.level === ActivityLevelKind.Plan ? engineMs({ node }) : node.totals.agentMs);

interface AccountingParams {
	label: string;
	ms: number;
	depth: number;
	headers: string[];
}

/**
 * A row for time inside a level that no row above it claims, so the level's
 * rows account for every second of its wall time and the engine's own work is
 * visible rather than inferred.
 */
const accountingRow = ({ label, ms, depth, headers }: AccountingParams): Row => ({
	cells: [`${indentOf({ depth })}${label}`, formatDuration({ ms }), ...headers.slice(2).map(() => notReported)],
	paintCell: ({ padded }: { padded: string }) => dim(padded),
	ruleAbove: false,
});

interface ProcessParams {
	/** The level the process ran inside — handed on so the estimator prices this one process through the shape it takes. */
	node: ActivityNode;
	process: HarnessProcessMark;
	depth: number;
	parentAgentMs?: number;
	pricing?: ConfigPricing;
}

/**
 * One harness process as a leaf row.
 *
 * The harness process is the deepest thing the tree shows, and it is the point
 * of the tree: a level-only table says which step was slow, where this row says
 * which single call to open. Its own duration is both its wall time and its
 * agent time — one process cannot overlap itself — and its peak is one.
 */
const processRow = ({ node, process, depth, parentAgentMs, pricing }: ProcessParams): Row => {
	const durationMs = Date.parse(process.endedAt) - Date.parse(process.startedAt);
	const named = [
		harnessProcessLabel({ process }),
		`#${process.spawn}`,
		...(process.reemit ? ['re-emit'] : []),
		`${clockOf({ at: process.startedAt })}–${clockOf({ at: process.endedAt })}`,
		process.endReason,
	];

	return {
		cells: [
			`${indentOf({ depth })}${named.join(' · ')}`,
			formatDuration({ ms: durationMs }),
			formatDuration({ ms: durationMs }),
			'1',
			shareCell({ ms: durationMs, ofMs: parentAgentMs }),
			...usageCells({ usage: process.usage }),
			// Priced through the shared estimator rather than by arithmetic of its
			// own: the estimator reads a node's processes and children, so one
			// process is handed to it as this level holding nothing else.
			...estimateCells({ node: { ...node, processes: [process], children: [] }, pricing }),
		],
		ruleAbove: false,
	};
};

interface RowParams {
	node: ActivityNode;
	depth: number;
	/** The parent's own agent time, which this level's share divides. Absent on a root, which has no parent to be a share of. */
	parentAgentMs?: number;
	pricing?: ConfigPricing;
	headers: string[];
}

const levelRow = ({ node, depth, parentAgentMs, pricing }: Omit<RowParams, 'headers'>): Row => ({
	cells: [
		`${indentOf({ depth })}${node.label}${node.endedAt === undefined ? ' · unfinished' : ''}`,
		formatDuration({ ms: node.totals.wallMs }),
		formatDuration({ ms: agentMsOf({ node }) }),
		`${node.totals.peakProcesses}`,
		shareCell({ ms: node.totals.agentMs, ofMs: parentAgentMs }),
		...usageCells({ usage: node.totals.usage }),
		...estimateCells({ node, pricing }),
	],
	emphasis: depth === 0 ? bold : undefined,
	// Roots are ruled apart from each other; everything inside one reads as a
	// block, because a rule between forty tree rows hides the nesting it draws.
	ruleAbove: depth === 0,
});

/** One level, its children, its own processes, and then the time none of them claimed. */
const rowsFor = ({ node, depth, parentAgentMs, pricing, headers }: RowParams): Row[] => {
	const rows = [levelRow({ node, depth, parentAgentMs, pricing })];
	const waitingMs = (node.totals.wallMs ?? 0) - engineMs({ node });

	for (const child of node.children) {
		rows.push(...rowsFor({ node: child, depth: depth + 1, parentAgentMs: node.totals.agentMs, pricing, headers }));
	}

	for (const process of node.processes) {
		rows.push(processRow({ node, process, depth: depth + 1, parentAgentMs: node.totals.agentMs, pricing }));
	}

	// The plan's own gap, which is NOT the idle row below: a level's idle time is
	// its wall time minus the time any agent was running, which inside a command
	// run also counts the engine's deterministic work, where this is the plan's
	// wall time minus its command runs' wall times.
	if (node.level === ActivityLevelKind.Plan && waitingMs > 0) {
		rows.push(accountingRow({ label: 'waiting between command runs', ms: waitingMs, depth: depth + 1, headers }));
	}

	if (node.totals.idleMs !== undefined && node.totals.idleMs > 0) {
		rows.push(accountingRow({ label: 'idle — no agent running', ms: node.totals.idleMs, depth: depth + 1, headers }));
	}

	return rows;
};

/**
 * One plan's totalled tree as table lines.
 *
 * Every figure but the estimate comes from the fold the record was read
 * through, so the terminal and the data-shaped payload beside it can never
 * disagree. Geometry is `renderTable`'s: the plain text is measured and the
 * paint applied afterwards, because an ANSI code is invisible on screen and
 * still counts toward a string's length.
 *
 * The estimated-cost column appears only when the repository configured a price
 * list, and its header says so — a computed figure standing unlabelled beside
 * ones a harness actually stated would read as one of them.
 */
export const renderActivityTree = ({ report, pricing }: Params): string[] => {
	const note = "estimated — this repository's configured rates applied to the recorded tokens; nothing computed from them is stored";
	// Only ever appended, so every other column sits where it sat without a price list.
	const headers = pricing === undefined ? baseHeaders : [...baseHeaders, 'estimated'];
	const rows = report.roots.flatMap((node) => rowsFor({ node, depth: 0, pricing, headers }));
	const table = renderTable({ headers, rows });

	return pricing === undefined ? table : [...table, dim(`  ${note}`)];
};
