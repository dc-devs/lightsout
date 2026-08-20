import { basename, dirname } from 'node:path';
import { PipelineKind } from '#src/contracts/index.ts';
import type { FrozenWorklist } from '#src/views/common/types/FrozenWorklist.ts';

/** At most this many rule ids read as a label rather than a list; the rest become a count. */
const namedRuleLimit = 3;

/** The distinct rules a refactor work-list froze, in the order its batches first name them. */
const describeRules = ({ rules }: { rules: string[] }) => {
	const distinct = [...new Set(rules)];
	const named = distinct.slice(0, namedRuleLimit).join(', ');
	const rest = distinct.length - namedRuleLimit;

	return rest > 0 ? `${named} +${rest} more` : named;
};

interface Params {
	/** Repo-relative plan path from the manifest. */
	plan: string;
	/** The run's frozen work-list, already parsed and tagged, when one was readable. */
	worklist?: FrozenWorklist;
}

/**
 * The human label a run answers to in a list.
 *
 * A frozen work-list names the run better than its path can: two refactor runs
 * differ by which rules they burn down, and their paths are identical. Where
 * there is no work-list, the plan path is the name — a plan's folder for the
 * `plan.md` and `overview.md` a folder is built around, and the file's own name
 * otherwise.
 */
export const getRunTitle = ({ plan, worklist }: Params): string => {
	const name = basename(plan);
	const stem = name.replace(/\.md$/, '');
	const folder = basename(dirname(plan));
	const rules = worklist?.kind === PipelineKind.Refactor ? (worklist.worklist?.batches.map((batch) => batch.rule) ?? []) : [];
	let title: string;

	if (worklist?.kind === PipelineKind.Coverage) {
		// No count: the frozen measurement carries no threshold and no per-file
		// pass/fail, so there is nothing honest to count in a title. The numbers
		// live on the detail page, where the run's own totals are in reach.
		title = PipelineKind.Coverage;
	} else if (worklist?.kind === PipelineKind.Refactor || name.endsWith('worklist.json')) {
		title = rules.length > 0 ? `${PipelineKind.Refactor} · ${describeRules({ rules })}` : PipelineKind.Refactor;
	} else if (stem === 'plan' || stem === 'overview') {
		title = folder;
	} else {
		title = /^phase\d+/.test(stem) ? `${folder} · ${stem}` : stem;
	}

	return title;
};
