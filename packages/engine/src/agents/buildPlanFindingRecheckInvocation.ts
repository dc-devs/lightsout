import planFindingRecheckPrompt from '#src/agents/prompts/planFindingRecheck.md';
import type { GradeFindingRecord } from '#src/contracts/index.ts';

interface Params {
	/** The current text of the plan file the record's question was raised against. */
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
}

/**
 * Assemble one plan finding re-check invocation deterministically. A grade run
 * spawns one of these per open record with the same brief, overview and
 * standards, so those live in the system prompt the harness caches through; the
 * current plan text and the single record are the per-invocation prompt.
 */
export const buildPlanFindingRecheckInvocation = ({ planText, overviewText, standards, planDir, record }: Params): { systemPrompt: string; prompt: string } => {
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

	sections.push(
		[
			'## The question on record',
			'',
			`- record: ${record.id}`,
			`- area: ${record.area}`,
			`- finding: ${record.gap}`,
			`- the reader says this must be decided: ${record.decision}`,
			`- options the reader offered: ${record.options.length > 0 ? record.options.join(' / ') : 'none offered'}`,
			`- what the original judge said a human must settle: ${record.humanDecision ?? 'not recorded'}`,
		].join('\n'),
		'Remember: your entire final message must be exactly one JSON GapVerdict object — nothing else.',
	);

	return {
		systemPrompt: roleSections.join('\n\n---\n\n'),
		prompt: sections.join('\n\n'),
	};
};
