import type { GradeDecisionLog } from '#src/contracts/index.ts';

type DecisionEntry = GradeDecisionLog['rows'][number];

interface Params {
	/** This pass's decision-log part; absent when this pass could not read the overview. */
	current?: GradeDecisionLog;
	/** The earlier pass's decision-log part; absent when that pass was recorded before the part existed. */
	previous?: GradeDecisionLog;
	/** Whether the overview's whole-file hash moved between the two passes — `getEditedPhases`' `overviewChanged`. */
	overviewChanged: boolean;
	/** The phase basenames whose own text changed this pass — `getEditedPhases`' `edited`. */
	edited: string[];
	/** Every phase-file basename the plan has now. */
	phaseFiles: string[];
}

/**
 * The rows of `rows` that `other` cannot pair up with a row of the same hash.
 * Each row of `other` pairs at most once, so a row repeated verbatim is matched
 * once per copy.
 */
const unmatchedRows = ({ rows, other }: { rows: DecisionEntry[]; other: DecisionEntry[] }) => {
	const available = other.map((row) => row.sha256);

	return rows.filter((row) => {
		const index = available.indexOf(row.sha256);

		if (index !== -1) {
			available.splice(index, 1);
		}

		return index === -1;
	});
};

/**
 * The changed rows of both passes, joined by every row on either side that
 * shares a changed row's question — which is how a revision covers the phases
 * its predecessor named. `previous` holds the joined rows of the earlier pass,
 * the ones whose scope was read against the earlier phase text.
 */
const joinedRows = ({ current, previous }: { current: GradeDecisionLog; previous: GradeDecisionLog }) => {
	const changed = [...unmatchedRows({ rows: current.rows, other: previous.rows }), ...unmatchedRows({ rows: previous.rows, other: current.rows })];
	const questions = new Set(changed.map((row) => row.questionSha256));
	const joinsChange = (row: DecisionEntry) => questions.has(row.questionSha256);

	return { changed, current: current.rows.filter(joinsChange), previous: previous.rows.filter(joinsChange) };
};

/**
 * Which phase files the Decision Log change between two passes reaches, or why
 * that cannot be placed.
 *
 * Rows are compared as a multiset of row hashes rather than by position, so one
 * deleted row reads as one changed row rather than as every later row moving.
 * The checks run in a fixed order and the first to fail is the answer. Every one
 * of them is a case where the reach is not known — a missing part, an overview
 * design edit, a log that moved with no row changed, a changed row that names no
 * phases or names a file the plan does not have, and an earlier scope whose
 * connections this pass's phase edits may have cut — and a reach that is not
 * known comes back as an error, never as a narrower answer. Walking the
 * connections from the answer is left to `getAffectedPhases`.
 *
 * @returns the sorted, deduplicated phase basenames the changed rows name, or an
 * error the caller turns into a full review
 */
export const getDecisionReach = ({ current, previous, overviewChanged, edited, phaseFiles }: Params): { phases: string[] } | { error: string } => {
	if (previous === undefined) {
		return { error: 'the earlier pass has no decision evidence to compare against' };
	}

	if (current === undefined) {
		return { error: 'this pass could not read the overview, so its decisions cannot be compared' };
	}

	if (current.overview !== previous.overview) {
		return { error: 'the overview changed outside its Decision Log, and it is context every phase shares' };
	}

	const joined = joinedRows({ current, previous });

	if (overviewChanged && joined.changed.length === 0) {
		return { error: 'the overview moved but no decision row changed, so where the change reaches cannot be placed' };
	}

	const rows = [...joined.current, ...joined.previous];

	if (rows.some((row) => row.phases === undefined)) {
		return { error: 'a changed decision names no phases, so it may reach the whole plan' };
	}

	const named = [...new Set(rows.flatMap((row) => row.phases ?? []))].sort();
	const unknown = named.filter((phase) => !phaseFiles.includes(phase));

	if (unknown.length > 0) {
		return { error: `a changed decision names ${unknown.join(', ')}, which is not a phase file of this plan` };
	}

	if (edited.length > 0 && joined.previous.length > 0) {
		return { error: 'a superseded or removed decision named phases while phase text also changed, so the connections its scope ran along may be gone' };
	}

	return { phases: named };
};
