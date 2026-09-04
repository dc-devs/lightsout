import { contractRule } from '#src/agents/buildPlanWriterInvocation/common/utils/contractRule.ts';
import { documentationRule } from '#src/agents/buildPlanWriterInvocation/common/utils/documentationRule.ts';
import { documentationSection } from '#src/agents/buildPlanWriterInvocation/common/utils/documentationSection.ts';
import { ledgerSection } from '#src/agents/buildPlanWriterInvocation/common/utils/ledgerSection.ts';
import { overviewSection } from '#src/agents/buildPlanWriterInvocation/common/utils/overviewSection.ts';
import { phaseSection } from '#src/agents/buildPlanWriterInvocation/common/utils/phaseSection.ts';
import { applyPromptTokens } from '#src/agents/common/utils/applyPromptTokens.ts';
import planTemplate from '#src/agents/prompts/planTemplate.md';
import planWriterPrompt from '#src/agents/prompts/planWriter.md';
import { type ConfigDocs, type DecisionsRecord, type PlanFacts, PlanVariant } from '#src/contracts/index.ts';
import type { PhaseDeclaration } from '#src/plan/index.ts';

interface Params {
	facts: PlanFacts;
	decisions: DecisionsRecord;
	/** Where to write each plan file, and its template variant. */
	outputs: { path: string; variant: PlanVariant }[];
	/** The settled overview text — present only on a phase spawn. */
	overviewText?: string;
	/** The declaration row this spawn authors against — present only on a phase spawn. */
	declaration?: PhaseDeclaration;
	/** The previous phase's declaration row — what this phase's Prerequisites must state. Absent for phase 1. */
	previousDeclaration?: PhaseDeclaration;
	/** Numbers the template's size rules are stated with. */
	limits: { executorFileLimit: number; createdFileCeiling: number };
	/** Supplemental code standards, inlined verbatim. Absent = non-fatal. */
	standards?: string;
	/** Exact self-lint command the writer runs before reporting. Absent = prose self-review only. */
	lintCommand?: string;
	/** The repository's declared documentation surfaces. Absent = this repository declares none, and the writer sees no documentation text anywhere in the invocation. */
	docs?: ConfigDocs;
	/** `plan.contract` from config. True = write the contract shape with an acceptance-test ledger. Absent or false = the invocation is byte-identical to the one produced before the key existed. */
	contract?: boolean;
}

/**
 * Assemble the plan-writer invocation deterministically. The role prompt and the
 * plan template are stable, so they live in the system prompt (the template
 * appended as a labelled section, with the engine's size numbers substituted in
 * so the prompt and the checks cannot disagree); the request, decisions, facts,
 * output paths, and any supplemental standards are the per-invocation prompt.
 *
 * Three spawn shapes share this builder: a single plan (neither phased section),
 * the overview spawn that opens a phased draft, and one phase spawn per declared
 * phase. The last two are mutually exclusive — an overview output means author
 * the overview alone, a `declaration` means author that one phase file.
 *
 * The documentation brief and the template's documentation rule are both driven
 * by the repository's declared surfaces, so a repository declaring none produces
 * a byte-identical invocation to the one it produced before the key existed. The
 * ledger brief and the template's contract rule follow the same shape off
 * `plan.contract`.
 */
export const buildPlanWriterInvocation = ({
	facts,
	decisions,
	outputs,
	overviewText,
	declaration,
	previousDeclaration,
	limits,
	standards,
	lintCommand,
	docs,
	contract,
}: Params): { systemPrompt: string; prompt: string } => {
	const outputLines = outputs.map((output) => `- ${output.path} — variant: ${output.variant}`);
	const sections = [`# Draft input`, `## Feature request\n\n${facts.request}`, `## Output files\n\n${outputLines.join('\n')}`];
	const overview = outputs.find((output) => output.variant === PlanVariant.Overview);

	if (overview) {
		sections.push(overviewSection({ path: overview.path }));
	}

	if (declaration && overviewText !== undefined) {
		sections.push(phaseSection({ path: outputs[0].path, overviewText, declaration, previousDeclaration }));
	}

	if (docs && docs.length > 0) {
		sections.push(documentationSection({ docs }));
	}

	if (contract === true) {
		sections.push(ledgerSection());
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

	sections.push(
		'Remember: write the plan file(s) to disk first, then your entire final message must be exactly one JSON PlanDraftReport object — nothing else.',
	);

	const template = applyPromptTokens({
		text: planTemplate,
		tokens: {
			fileLimit: limits.executorFileLimit,
			createdFileCeiling: limits.createdFileCeiling,
			documentationRule: documentationRule({ docs }),
			contractRule: contractRule({ contract }),
		},
	});

	return {
		systemPrompt: `${planWriterPrompt}\n\n---\n\n# Plan Template\n\n${template}`,
		prompt: sections.join('\n\n'),
	};
};
