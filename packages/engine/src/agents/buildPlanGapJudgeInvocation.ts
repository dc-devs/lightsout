import planGapJudgePrompt from '#src/agents/prompts/planGapJudge.md';
import type { GapObservation, GradeFindingRecord } from '#src/contracts/index.ts';

interface Params {
	/** The batch's `planTexts` verbatim: one entry per location its observations span, in the batch's own order. */
	planTexts: Array<{ phase: string; text: string }>;
	/** Overview plan text — context for a phased plan, never judged standalone. */
	overviewText?: string;
	/** Supplemental code standards, inlined verbatim — part of what the agent could derive the answer from. */
	standards?: string;
	/**
	 * The plan's folder, repo-relative — named so the judge can open a SIBLING
	 * phase file its batch does not span when an observation is about a seam. Not
	 * the text of those files: every phase inlined into every judge is the
	 * read-the-whole-plan-at-once shape the readers were split away from. The
	 * judge already has repository access; this tells it where to look. Absent
	 * for a single-file plan, which has no siblings.
	 */
	planDir?: string;
	/** Every record the memory holds for any phase in `planTexts`, de-duplicated by id — what `matchesFinding` may name. */
	records?: GradeFindingRecord[];
	/** The observations under judgment, each with the engine identifier `covers` must name it by. */
	observations: Array<{ id: string; observation: GapObservation }>;
}

/** One line per record, and the rule that turns the list into an answer the engine can validate. */
const recordsSection = ({ records }: { records: GradeFindingRecord[] }) =>
	[
		'## Findings already on record',
		'',
		...records.map((record) => `- ${record.id} (${record.status}) — ${record.gap}`),
		'',
		'Decide first, for each ruling, whether it is the SAME QUESTION as one of these. If',
		"it is, put that record's id in the ruling's `matchesFinding`; otherwise leave the",
		'field unset. Never name an id that is not on this list — one the plan does not',
		'hold points nowhere, and the engine treats that ruling as no answer at all.',
		'',
		'Matching is orthogonal to your ruling: a matched finding still gets a full verdict.',
		'A match you rule `needs-a-human` REOPENS a closed record, so rule that way only on',
		'evidence the earlier clearance was wrong or that its assumptions have changed.',
	].join('\n');

/** One observation under its engine identifier — the name `covers` must use for it. */
const observationEntry = ({ id, observation }: { id: string; observation: GapObservation }) =>
	[
		`### ${id}`,
		'',
		`- plan file: ${observation.phase}`,
		`- area: ${observation.area}`,
		`- lens: ${observation.lens}`,
		`- finding: ${observation.gap}`,
		`- the reader says this must be decided: ${observation.decision}`,
		`- options the reader offered: ${observation.options.length > 0 ? observation.options.join(' / ') : 'none offered'}`,
	].join('\n');

/**
 * Assemble one plan gap-judge invocation deterministically. A grade run spawns
 * one judge per candidate batch with the same brief, overview and standards, so
 * those live in the system prompt the harness caches through; the text of every
 * plan file the batch spans and the observations under judgment are the
 * per-invocation prompt.
 */
export const buildPlanGapJudgeInvocation = ({
	planTexts,
	overviewText,
	standards,
	planDir,
	records,
	observations,
}: Params): { systemPrompt: string; prompt: string } => {
	const roleSections = [planGapJudgePrompt];

	if (overviewText) {
		roleSections.push(`# Overview (context only — do not judge standalone)\n\n${overviewText}`);
	}

	if (standards) {
		roleSections.push(`# Code standards\n\nThe implementing agent loads these too — they are part of what it could derive the answer from:\n\n${standards}`);
	}

	const sections = ['# Gap-judge input', ...planTexts.map(({ phase, text }) => `## Plan file: ${phase}\n\n${text}`)];

	if (planDir) {
		sections.push(
			`## The plan's other phases\n\nThe plan's other phase files are in \`${planDir}\`. Open one when an observation is about something a neighbouring phase this batch does not span produces or consumes; ignore them otherwise.`,
		);
	}

	if (records && records.length > 0) {
		sections.push(recordsSection({ records }));
	}

	sections.push(
		['## The observations to judge', '', observations.map((entry) => observationEntry(entry)).join('\n\n')].join('\n'),
		'Remember: your entire final message must be exactly one JSON GapBatchVerdict object — nothing else.',
	);

	return {
		systemPrompt: roleSections.join('\n\n---\n\n'),
		prompt: sections.join('\n\n'),
	};
};
