import { renderProgressBlock } from '#src/cli/common/progressBlock/renderProgressBlock.ts';
import { type PlanningCanonicalProgress, RunStatus } from '#src/contracts/index.ts';

/** How a work item is named in the block: its role, then the record's own id, because a plan decides both. */
const workLabel = ({ work }: { work: PlanningCanonicalProgress['work'][number] }) => `${work.role}:${work.id}`;

/** What can be said about reuse — never a count invented for a record that holds none. */
const reuseLine = ({ reuse }: Pick<PlanningCanonicalProgress, 'reuse'>) => {
	if (reuse === undefined) {
		return ' reuse    unavailable — this generation records no saved conclusion';
	}

	return ` reuse    ${reuse.savedConclusions} saved conclusion(s) · ${reuse.repairedFindings} finding(s) repaired and verified`;
};

/**
 * What planning has been billed, and how much of that is unknown.
 *
 * A call the harness reported nothing for is named rather than summed as zero,
 * and a plan whose calls all reported nothing shows no figure at all: the
 * spend is unavailable, which is a different fact from free.
 */
const spendLine = ({ usage }: Pick<PlanningCanonicalProgress, 'usage'>) => {
	if (usage.calls === 0) {
		return ' spend    unavailable — no planning call is recorded here';
	}

	const unreported = usage.unreported === 0 ? '' : ` · usage unavailable for ${usage.unreported} of ${usage.calls}`;

	if (usage.totals === undefined) {
		return ` spend    unavailable — none of ${usage.calls} recorded call(s) reported usage`;
	}

	const tokens = usage.totals.inputTokens + usage.totals.outputTokens;

	return ` spend    $${usage.totals.costUsd.toFixed(2)} · ${tokens} token(s) over ${usage.calls - usage.unreported} of ${usage.calls} call(s)${unreported}`;
};

/** The implement run's own outcome, which planning cost can never stand in for. */
const implementationLine = ({ implementation }: Pick<PlanningCanonicalProgress, 'implementation'>) =>
	implementation === undefined
		? ' implementation  unavailable — this repository holds no implement run for the plan'
		: ` implementation  run ${implementation.runId} ${implementation.status}`;

/** What planning is doing now: a running item first, then the next one waiting, then what is left holding it up. */
const canonicalNow = ({ canonical }: { canonical: PlanningCanonicalProgress }) => {
	const running = canonical.work.find((work) => work.status === RunStatus.Running);
	const waiting = canonical.work.find((work) => work.status === RunStatus.Pending);
	let text = 'no work item is recorded yet';

	if (running !== undefined) {
		text = `${workLabel({ work: running })} running`;
	} else if (waiting !== undefined) {
		text = `${workLabel({ work: waiting })} not started`;
	} else if (canonical.blockers.length > 0) {
		text = `held by ${canonical.blockers.length} open blocking finding(s)`;
	} else if (canonical.work.length > 0) {
		text = 'every recorded work item has a result';
	}

	return text;
};

interface Params {
	/** Kebab plan name, drawn on the title line. */
	name: string;
	canonical: PlanningCanonicalProgress;
}

/**
 * A canonically-stored plan's block as lines, in the shared progress layout.
 *
 * It draws the work the record actually holds rather than the five fixed
 * planning steps, because canonical work ids are chosen per plan and pressing
 * them into that enum would invent a denominator no plan has. Readiness is not
 * claimed anywhere: the rows say what each work item recorded, the diagnostics
 * say what is still open and what is simply not recorded, and the
 * implementation line reads the run's own manifest.
 */
export const renderCanonicalPlanningBlock = ({ name, canonical }: Params): string[] => {
	const rows = canonical.work.map((work) => ({ id: workLabel({ work }), status: work.status, attempts: work.attempts, durationMs: undefined }));
	const complete = rows.filter((row) => row.status === RunStatus.Passed).length;

	return renderProgressBlock({
		title: name,
		tag: 'planning',
		rows,
		diagnostics: [...canonical.blockers.map((blocker) => ` blocked  ${blocker}`), reuseLine(canonical), spendLine(canonical), implementationLine(canonical)],
		totals: `${complete} of ${rows.length} work item(s) with a result · ${canonical.blockers.length} blocking finding(s) open`,
		now: canonicalNow({ canonical }),
	});
};
