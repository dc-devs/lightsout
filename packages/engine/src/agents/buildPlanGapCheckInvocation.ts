import planGapCheckPrompt from '@/agents/prompts/planGapCheck.md';

interface Params {
	/** The plan text to check for decision-level gaps. */
	planText: string;
	/** Overview plan text — context for a phased plan, never graded standalone. */
	overviewText?: string;
	/** Supplemental code standards, inlined verbatim so standards-conflict can fire. */
	standards?: string;
}

/**
 * Assemble one plan gap-check invocation deterministically. A grade run spawns
 * one checker per phase file with the same overview and standards, so those
 * live in the system prompt (the harness caches through it) and only the plan
 * text under check varies per spawn.
 */
export const buildPlanGapCheckInvocation = ({ planText, overviewText, standards }: Params): { systemPrompt: string; prompt: string } => {
	const roleSections = [planGapCheckPrompt];

	if (overviewText) {
		roleSections.push(`# Overview (context only — do not grade standalone)\n\n${overviewText}`);
	}

	if (standards) {
		roleSections.push(`# Code standards\n\nThe implementing agent loads these too — flag only where the plan contradicts them:\n\n${standards}`);
	}

	const sections = [
		`# Gap-check input`,
		`## Plan to check\n\n${planText}`,
		'Remember: your entire final message must be exactly one JSON GapCheckReport object — nothing else.',
	];

	return {
		systemPrompt: roleSections.join('\n\n---\n\n'),
		prompt: sections.join('\n\n'),
	};
};
