import planFindingRecheckPrompt from '#src/agents/prompts/planFindingRecheck.md';
import type { GapObservation, GradeFindingRecord } from '#src/contracts/index.ts';

interface Params {
	/** The current text of the plan file this spawn asks about. */
	planText: string;
	/** Overview plan text — context for a phased plan, never judged standalone. */
	overviewText?: string;
	/** Supplemental code standards, inlined verbatim — part of what the plan could state the answer through. */
	standards?: string;
	/**
	 * The plan's folder, repo-relative — named so the judge can open a sibling
	 * phase file when a repair moved the answer into one. Absent for a single
	 * plan, which has no siblings.
	 */
	planDir?: string;
	/** The one open record this judge re-checks. */
	record: GradeFindingRecord;
	/** The record's observation at the plan file this spawn asks about. */
	observation?: GapObservation;
	/**
	 * Every plan file the record spans, in the caller's order. Passed in rather
	 * than derived here, because the rule that derives it lives inside the plan
	 * module. Two or more is what makes this spawn one location of several; the
	 * observation's presence alone says nothing, since the caller passes one on
	 * every spawn.
	 */
	locations?: string[];
}

/**
 * Assemble one plan finding re-check invocation deterministically. A grade run
 * spawns one of these per location of every open record with the same brief,
 * overview and standards, so those live in the system prompt the harness caches
 * through; the current plan text and the single record are the per-invocation
 * prompt.
 *
 * For a record spanning several plan files the question is asked in the covered
 * location's own reader's words, and a line names the file this spawn covers and
 * the record's other locations, so the judge answers for this file alone. A
 * record with one location gets exactly the prompt it got before grouping
 * existed.
 */
export const buildPlanFindingRecheckInvocation = ({
	planText,
	overviewText,
	standards,
	planDir,
	record,
	observation,
	locations = [],
}: Params): { systemPrompt: string; prompt: string } => {
	const roleSections = [planFindingRecheckPrompt];

	if (overviewText) {
		roleSections.push(`# Overview (context only — do not judge standalone)\n\n${overviewText}`);
	}

	if (standards) {
		roleSections.push(`# Code standards\n\nThe implementing agent loads these too — they are part of what the plan could settle this through:\n\n${standards}`);
	}

	const sections = [`# Finding-recheck input`, `## The plan as it reads now\n\n${planText}`];

	if (planDir) {
		sections.push(
			`## The plan's other phases\n\nThe plan's other phase files are in \`${planDir}\`. Open one when the answer to this question plausibly moved there; ignore them otherwise.`,
		);
	}

	const located = locations.length > 1 ? observation : undefined;
	const asked = located ?? record;
	const others = locations.filter((location) => location !== asked.phase).join(', ');
	const where = located === undefined ? [] : [`- this spawn asks about ${located.phase} only; the record also appears in ${others}`];

	sections.push(
		[
			'## The question on record',
			'',
			`- record: ${record.id}`,
			...where,
			`- area: ${asked.area}`,
			`- finding: ${asked.gap}`,
			`- the reader says this must be decided: ${asked.decision}`,
			`- options the reader offered: ${asked.options.length > 0 ? asked.options.join(' / ') : 'none offered'}`,
			`- what the original judge said a human must settle: ${record.humanDecision ?? 'not recorded'}`,
		].join('\n'),
		'Remember: your entire final message must be exactly one JSON GapVerdict object — nothing else.',
	);

	return {
		systemPrompt: roleSections.join('\n\n---\n\n'),
		prompt: sections.join('\n\n'),
	};
};
