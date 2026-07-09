import { dirname } from 'node:path';
import type { DecisionsRecord, PlanFacts, PlanVariant } from '@lightsout/contracts';
import planWriterPrompt from '../prompts/planWriter.md';
import planTemplate from '../prompts/planTemplate.md';

interface Params {
	facts: PlanFacts;
	decisions: DecisionsRecord;
	/** Where to write each plan file, and its template variant. */
	outputs: { path: string; variant: PlanVariant }[];
	/** Supplemental code standards, inlined verbatim. Absent = non-fatal. */
	standards?: string;
}

/**
 * Assemble the plan-writer invocation deterministically. The role prompt and the
 * plan template are stable, so they live in the system prompt (the template
 * appended as a labelled section); the request, decisions, facts, output paths,
 * and any supplemental standards are the per-invocation prompt.
 */
export const buildPlanWriterInvocation = ({ facts, decisions, outputs, standards }: Params): { systemPrompt: string; prompt: string } => {
	const outputLines = outputs.map((output) => `- ${output.path} — variant: ${output.variant}`);
	const sections = [
		`# Draft input`,
		`## Feature request\n\n${facts.request}`,
		`## Output files\n\n${outputLines.join('\n')}`,
	];

	// A phased draft is a single spawn that authors the overview plus every phase
	// file into one directory — name the directory explicitly so the agent's hard
	// naming rule (overview.md + phase<N>-<slug>.md) lands where grade globs.
	const overview = outputs.find((output) => output.variant === 'overview');

	if (overview) {
		sections.push(
			`## Phased authoring\n\nAuthor the overview at \`${overview.path}\` and one phase file per phase named \`phase<N>-<slug>.md\` in \`${dirname(overview.path)}\`. Choose the phase breakdown and slugs yourself; report every written path in \`filesWritten\`.`,
		);
	}

	sections.push(`## Decisions record\n\n\`\`\`json\n${JSON.stringify(decisions, undefined, '\t')}\n\`\`\``);
	sections.push(`## Verified facts\n\n\`\`\`json\n${JSON.stringify(facts, undefined, '\t')}\n\`\`\``);

	if (standards) {
		sections.push(`## Code standards (supplemental)\n\nApply these where they bear on the plan; they are guidance, not a hard gate:\n\n${standards}`);
	}

	sections.push('Remember: write the plan file(s) to disk first, then your entire final message must be exactly one JSON PlanDraftReport object — nothing else.');

	return {
		systemPrompt: `${planWriterPrompt}\n\n---\n\n# Plan Template\n\n${planTemplate}`,
		prompt: sections.join('\n\n'),
	};
};
