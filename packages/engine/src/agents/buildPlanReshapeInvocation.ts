import planReshapePrompt from '#src/agents/prompts/planReshape.md';
import type { StructuralFinding } from '#src/contracts/index.ts';

interface Params {
	/** The typed breakdown findings to resolve, each with its exact fix. */
	findings: StructuralFinding[];
	/** Absolute path(s) of the overview file to Edit in place. */
	planPaths: string[];
	/** The hard per-phase created-file ceiling, stated so the reshaper splits against the same number the check applies. */
	createdFileCeiling: number;
	/** Absolute path of the workspace's decisions.json — the reshaper Reads it on demand. */
	decisionsPath: string;
	/** Absolute path of the workspace's brainstorm-decisions.json when one exists — the reshaper Reads it on demand. */
	brainstormDecisionsPath?: string;
	/** Absolute path of the workspace's facts.json — the reshaper Reads it on demand. */
	factsPath: string;
}

/**
 * Assemble one phase-breakdown reshape invocation deterministically: the
 * findings (with their exact fix strings), the overview path to edit in place,
 * the ceiling every phase must come in under, and the facts/decisions as
 * *paths* the reshaper Reads only when a re-split needs their content.
 *
 * A sibling of `buildPlanRepairInvocation` rather than a use of it: that
 * builder's role prompt opens "You do NOT re-author it" and makes minimal,
 * non-restructuring edits a hard rule — which is exactly what re-splitting a
 * breakdown is not. The repairer's narrowness is what makes it safe on a
 * finished plan, so it stays narrow and this stands beside it.
 */
export const buildPlanReshapeInvocation = ({
	findings,
	planPaths,
	createdFileCeiling,
	decisionsPath,
	brainstormDecisionsPath,
	factsPath,
}: Params): { systemPrompt: string; prompt: string } => {
	const findingLines = findings.map((finding) => `- [${finding.check}] ${finding.location} — ${finding.issue}\n  fix: ${finding.fix}`);
	const referenceLines = [
		`- Decisions record: ${decisionsPath}`,
		...(brainstormDecisionsPath ? [`- Brainstorm decisions (settled during brainstorm, before planning began): ${brainstormDecisionsPath}`] : []),
		`- Verified facts: ${factsPath}`,
	];
	const sections = [
		`# Reshape input`,
		`## Overview file to reshape (Edit in place)\n\n- ${planPaths.join('\n- ')}`,
		`## Created-file ceiling\n\nNo phase may declare more than ${createdFileCeiling} created source files. This is fixed and no declaration raises it.`,
		`## Breakdown findings to resolve\n\n${findingLines.join('\n')}`,
		`## Reference files (Read on demand)\n\n${referenceLines.join('\n')}`,
		'Remember: re-split the phase breakdown, touch nothing else, then your entire final message must be exactly one JSON PlanFixReport object — nothing else.',
	];

	return {
		systemPrompt: planReshapePrompt,
		prompt: sections.join('\n\n'),
	};
};
