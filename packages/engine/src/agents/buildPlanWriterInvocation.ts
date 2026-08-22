import { applyPromptTokens } from '#src/agents/common/utils/applyPromptTokens.ts';
import planTemplate from '#src/agents/prompts/planTemplate.md';
import planWriterPrompt from '#src/agents/prompts/planWriter.md';
import { type DecisionsRecord, type PlanFacts, PlanVariant } from '#src/contracts/index.ts';
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
}

/**
 * The overview spawn's brief: author that one file, and nothing else. The phase
 * files are written by separate agents from the declarations this spawn settles,
 * so a phase it does not declare is never authored at all.
 */
const overviewSection = ({ path }: { path: string }) =>
	`## Overview only

Author \`${path}\` and nothing else — not one phase file. A separate agent authors each phase file from the breakdown you write here, all of them at once, and none of them ever reads another phase's file. A phase you do not declare is never written.

That makes two sections load-bearing rather than decorative:

- \`## Phases\` — one row per phase, carrying its number, its \`phase<N>-<slug>.md\` filename, a one-line scope, and integer \`Creates\` and \`Touches\` counts. Numbers run 1..n with no gaps; each filename agrees with its number.
- \`## Phase Declarations\` — one \`### Phase <N> — \` block per row, listing ONLY what crosses a phase boundary: the files a later phase builds against, the exported names later phases import, and the package scripts that phase adds. Write \`none\` for a bullet with nothing to declare.

The counts are your estimate; the engine recomputes them from the finished phase files afterwards. The declarations are not an estimate — a phase writer is held to them.

Report only this file in \`filesWritten\`.`;

/** One declaration row as the phase writer receives it: the overview's own JSON, never a paraphrase. */
const declarationBlock = ({ label, declaration }: { label: string; declaration: PhaseDeclaration }) =>
	`### ${label}\n\n\`\`\`json\n${JSON.stringify(declaration, undefined, '\t')}\n\`\`\``;

/**
 * The phase spawn's brief: one file, authored against a settled declaration
 * rather than against its sibling phases, which are being written at the same
 * moment and are not on disk. Both sides of every hand-off are derived from the
 * same declaration rows, so the names match by construction rather than by two
 * agents happening to spell them alike.
 */
const phaseSection = ({
	path,
	overviewText,
	declaration,
	previousDeclaration,
}: {
	path: string;
	overviewText: string;
	declaration: PhaseDeclaration;
	previousDeclaration?: PhaseDeclaration;
}) =>
	`## Phase authoring

Author \`${path}\` and nothing else. The phase breakdown is already settled — do not re-decide it, do not renumber, and do not write any other phase's file. Every other phase is being authored right now by another agent, so no sibling phase file exists for you to read: the declarations below are the whole of what you may rely on. Report only this file in \`filesWritten\`.

${declarationBlock({ label: "This phase's declaration", declaration })}

${
	previousDeclaration === undefined
		? '### The previous phase\n\nThis is phase 1 — there is no previous phase.'
		: declarationBlock({ label: "The previous phase's declaration", declaration: previousDeclaration })
}

### Writing against the declaration

- The declared \`creates\`, \`exports\` and \`scripts\` are a **floor, not a ceiling**. Your file MUST create every declared path, export every declared name and add every declared script — and is free to create whatever else the phase needs. The declaration lists only what crosses a phase boundary, so an internal file no other phase touches is never in it.
- The declared \`createdCount\` and \`touchedCount\` are the overview agent's **estimate** and are not a target. Write what the work requires; the engine stamps the real counts into the overview afterwards. The only hard limits are the created-file ceiling and this phase's own \`## File Budget\`.
- \`## What Next Plan Expects\` states this phase's own declared \`creates\`, \`exports\` and \`scripts\`, each in a backticked span, and nothing else. Write \`None.\` when every bullet of your declaration is \`none\`, and \`None — final phase.\` when your row is the last in the overview's \`## Phases\` table.
- \`## Prerequisites\` states the previous phase's declared \`creates\`, \`exports\` and \`scripts\`, each in a backticked span. Phase 1 states the pre-feature codebase state instead.
- \`## File Budget\` is written when the declaration carries a \`fileBudget\`, repeating that integer. If your phase's real work needs a HIGHER budget than the declaration states, write **the number you need** — never the declared one — and omit the section entirely if you need none. The mismatch is reported and resolved against the overview later; understating your budget to avoid a finding is the one thing that would actually break the run.

### The settled overview

${overviewText}`;

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
		tokens: { fileLimit: limits.executorFileLimit, createdFileCeiling: limits.createdFileCeiling },
	});

	return {
		systemPrompt: `${planWriterPrompt}\n\n---\n\n# Plan Template\n\n${template}`,
		prompt: sections.join('\n\n'),
	};
};
