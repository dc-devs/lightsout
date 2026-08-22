import planGapCheckPrompt from '#src/agents/prompts/planGapCheck.md';
import planGapCheckDecisionsPrompt from '#src/agents/prompts/planGapCheckDecisions.md';
import planGapCheckSurfacePrompt from '#src/agents/prompts/planGapCheckSurface.md';
import planGapCheckWiringPrompt from '#src/agents/prompts/planGapCheckWiring.md';
import { GapCheckLens } from '#src/contracts/index.ts';

interface Params {
	/** The plan text to check for decision-level gaps. */
	planText: string;
	/** Overview plan text — context for a phased plan, never graded standalone. */
	overviewText?: string;
	/** Supplemental code standards, inlined verbatim so standards-conflict can fire. */
	standards?: string;
	/** Which of the three jobs this checker is given. */
	lens: GapCheckLens;
}

/** The brief each lens is handed, appended to the shared role prompt. */
const lensBriefs: Record<GapCheckLens, string> = {
	[GapCheckLens.Surface]: planGapCheckSurfacePrompt,
	[GapCheckLens.Wiring]: planGapCheckWiringPrompt,
	[GapCheckLens.Decisions]: planGapCheckDecisionsPrompt,
};

/**
 * Assemble one plan gap-check invocation deterministically. A grade run spawns
 * one checker per plan file per lens with the same brief, overview and
 * standards, so those live in the system prompt (the harness caches through it)
 * and only the plan text under check varies between the spawns sharing a lens.
 */
export const buildPlanGapCheckInvocation = ({ planText, overviewText, standards, lens }: Params): { systemPrompt: string; prompt: string } => {
	const roleSections = [planGapCheckPrompt, lensBriefs[lens]];

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
