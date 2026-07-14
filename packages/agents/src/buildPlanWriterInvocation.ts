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
	/** Exact self-lint command the writer runs before reporting. Absent = prose self-review only. */
	lintCommand?: string;
}

/**
 * Assemble the plan-writer invocation deterministically. The role prompt and the
 * plan template are stable, so they live in the system prompt (the template
 * appended as a labelled section); the request, decisions, facts, output paths,
 * and any supplemental standards are the per-invocation prompt.
 */
export const buildPlanWriterInvocation = ({ facts, decisions, outputs, standards, lintCommand }: Params): { systemPrompt: string; prompt: string } => {
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

	if (lintCommand) {
		sections.push(
			'## Self-lint\n\nAfter writing the plan file(s) and before reporting, run:\n\n`' +
				lintCommand +
				'`\n\nIt prints structural findings and exits 1 while any remain, 0 when clean. Fix each finding in the plan file(s) and re-run until it exits 0. If a re-run reports the identical findings twice, stop and report anyway. If the command itself cannot be executed (denied tool, sandbox), skip it — the checklist self-review still applies and the engine re-lints your output either way.',
		);
	}

	sections.push('Remember: write the plan file(s) to disk first, then your entire final message must be exactly one JSON PlanDraftReport object — nothing else.');

	return {
		systemPrompt: `${planWriterPrompt}\n\n---\n\n# Plan Template\n\n${planTemplate}`,
		prompt: sections.join('\n\n'),
	};
};
