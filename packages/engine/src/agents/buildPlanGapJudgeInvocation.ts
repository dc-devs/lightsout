import planGapJudgePrompt from '#src/agents/prompts/planGapJudge.md';
import type { GradedGap, GradeFindingRecord } from '#src/contracts/index.ts';

interface Params {
	/** The plan file the finding was raised against. */
	planText: string;
	/** Overview plan text — context for a phased plan, never judged standalone. */
	overviewText?: string;
	/** Supplemental code standards, inlined verbatim — part of what the agent could derive the answer from. */
	standards?: string;
	/**
	 * The plan's folder, repo-relative — named so the judge can open a SIBLING
	 * phase file when the finding is about a seam. Not the text of those files:
	 * eight phases inlined into every one of twenty-odd judges is the
	 * read-the-whole-plan-at-once shape the readers were split away from. The
	 * judge already has repository access; this tells it where to look.
	 * Absent for a single-file plan, which has no siblings.
	 */
	planDir?: string;
	/** Every record the memory holds for this plan file, whatever its state — what `matchesFinding` may name. */
	records?: GradeFindingRecord[];
	/** The one finding this judge rules on. */
	gap: GradedGap;
}

/** One line per record, and the rule that turns the list into an answer the engine can validate. */
const recordsSection = ({ records }: { records: GradeFindingRecord[] }) =>
	[
		'## Findings already on record for this plan file',
		'',
		...records.map((record) => `- ${record.id} (${record.status}) — ${record.gap}`),
		'',
		'Decide first whether the finding below is the SAME QUESTION as one of these. If it',
		"is, put that record's id in `matchesFinding`; otherwise leave the field unset.",
		'Never name an id that is not on this list — one the plan does not hold points',
		'nowhere, and the engine treats it as no answer at all.',
		'',
		'Matching is orthogonal to your ruling: a matched finding still gets a full verdict.',
		'A match you rule `needs-a-human` REOPENS a closed record, so rule that way only on',
		'evidence the earlier clearance was wrong or that its assumptions have changed.',
	].join('\n');

/**
 * Assemble one plan gap-judge invocation deterministically. A grade run spawns
 * one judge per reader finding with the same brief, overview and standards, so
 * those live in the system prompt the harness caches through; the plan text and
 * the single finding under judgment are the per-invocation prompt.
 */
export const buildPlanGapJudgeInvocation = ({ planText, overviewText, standards, planDir, records, gap }: Params): { systemPrompt: string; prompt: string } => {
	const roleSections = [planGapJudgePrompt];

	if (overviewText) {
		roleSections.push(`# Overview (context only — do not judge standalone)\n\n${overviewText}`);
	}

	if (standards) {
		roleSections.push(`# Code standards\n\nThe implementing agent loads these too — they are part of what it could derive the answer from:\n\n${standards}`);
	}

	const sections = [`# Gap-judge input`, `## Plan the finding was raised against\n\n${planText}`];

	if (planDir) {
		sections.push(
			`## The plan's other phases\n\nThe plan's other phase files are in \`${planDir}\`. Open one when this finding is about something a neighbouring phase produces or consumes; ignore them otherwise.`,
		);
	}

	if (records && records.length > 0) {
		sections.push(recordsSection({ records }));
	}

	sections.push(
		[
			'## The finding to judge',
			'',
			`- area: ${gap.area}`,
			`- lens: ${gap.lens}`,
			`- finding: ${gap.gap}`,
			`- the reader says this must be decided: ${gap.decision}`,
			`- options the reader offered: ${gap.options.length > 0 ? gap.options.join(' / ') : 'none offered'}`,
		].join('\n'),
		'Remember: your entire final message must be exactly one JSON GapVerdict object — nothing else.',
	);

	return {
		systemPrompt: roleSections.join('\n\n---\n\n'),
		prompt: sections.join('\n\n'),
	};
};
