import type { DecisionsRecord, PlanFacts, StructuralFinding } from '@lightsout/contracts';
import planRepairPrompt from '../prompts/planRepair.md';

interface Params {
	/** The typed structural findings to resolve, each with its exact fix. */
	findings: StructuralFinding[];
	/** Absolute paths of the drafted plan file(s) to Edit in place. */
	planPaths: string[];
	/** Reference material for resolving placeholder content. */
	facts: PlanFacts;
	decisions: DecisionsRecord;
}

/**
 * Assemble one draft-repair invocation deterministically: the findings (with
 * their exact fix strings), the plan file paths to edit in place, and the
 * facts/decisions as reference. The plan template is deliberately absent —
 * the repair role edits, never re-authors.
 */
export const buildPlanRepairInvocation = ({ findings, planPaths, facts, decisions }: Params): { systemPrompt: string; prompt: string } => {
	const findingLines = findings.map((finding) => `- [${finding.check}] ${finding.location} — ${finding.issue}\n  fix: ${finding.fix}`);
	const sections = [
		`# Repair input`,
		`## Plan files to repair (Edit in place)\n\n- ${planPaths.join('\n- ')}`,
		`## Structural findings to resolve\n\n${findingLines.join('\n')}`,
		`## Decisions record (reference)\n\n\`\`\`json\n${JSON.stringify(decisions, undefined, '\t')}\n\`\`\``,
		`## Verified facts (reference)\n\n\`\`\`json\n${JSON.stringify(facts, undefined, '\t')}\n\`\`\``,
		'Remember: minimal edits resolving only the flagged findings, then your entire final message must be exactly one JSON PlanFixReport object — nothing else.',
	];

	return {
		systemPrompt: planRepairPrompt,
		prompt: sections.join('\n\n'),
	};
};
