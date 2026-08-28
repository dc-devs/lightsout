import planGapJudgePrompt from '#src/agents/prompts/planGapJudge.md';
import type { GradedGap } from '#src/contracts/index.ts';

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
	/** The one finding this judge rules on. */
	gap: GradedGap;
}

/**
 * Assemble one plan gap-judge invocation deterministically. A grade run spawns
 * one judge per reader finding with the same brief, overview and standards, so
 * those live in the system prompt the harness caches through; the plan text and
 * the single finding under judgment are the per-invocation prompt.
 */
export const buildPlanGapJudgeInvocation = ({ planText, overviewText, standards, planDir, gap }: Params): { systemPrompt: string; prompt: string } => {
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
