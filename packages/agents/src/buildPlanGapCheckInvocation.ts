import planGapCheckPrompt from '../prompts/planGapCheck.md';

interface Params {
	/** The plan text to check for decision-level gaps. */
	planText: string;
	/** Overview plan text — context for a phased plan, never graded standalone. */
	overviewText?: string;
	/** Supplemental code standards, inlined verbatim so standards-conflict can fire. */
	standards?: string;
}

/** Assemble one plan gap-check invocation deterministically. */
export const buildPlanGapCheckInvocation = ({ planText, overviewText, standards }: Params) => {
	const sections = [`# Gap-check input`];

	if (overviewText) {
		sections.push(`## Overview (context only — do not grade standalone)\n\n${overviewText}`);
	}

	sections.push(`## Plan to check\n\n${planText}`);

	if (standards) {
		sections.push(`## Code standards\n\nThe implementing agent loads these too — flag only where the plan contradicts them:\n\n${standards}`);
	}

	sections.push('Remember: your entire final message must be exactly one JSON GapCheckReport object — nothing else.');

	return {
		systemPrompt: planGapCheckPrompt,
		prompt: sections.join('\n\n'),
	};
};
