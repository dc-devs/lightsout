import type { StructuralFinding } from '@/contracts';
import planRepairPrompt from '@/agents/prompts/planRepair.md';

interface Params {
	/** The typed structural findings to resolve, each with its exact fix. */
	findings: StructuralFinding[];
	/** Absolute paths of the drafted plan file(s) to Edit in place. */
	planPaths: string[];
	/** Absolute path of the workspace's decisions.json — the repairer Reads it on demand. */
	decisionsPath: string;
	/** Absolute path of the workspace's brainstorm-decisions.json when one exists — the repairer Reads it on demand. */
	brainstormDecisionsPath?: string;
	/** Absolute path of the workspace's facts.json — the repairer Reads it on demand. */
	factsPath: string;
}

/**
 * Assemble one draft-repair invocation deterministically: the findings (with
 * their exact fix strings), the plan file paths to edit in place, and the
 * facts/decisions as *paths* the repairer Reads only when a fix requires their
 * content — the common mechanical repair never pays for them. The plan
 * template is deliberately absent — the repair role edits, never re-authors.
 */
export const buildPlanRepairInvocation = ({ findings, planPaths, decisionsPath, brainstormDecisionsPath, factsPath }: Params): { systemPrompt: string; prompt: string } => {
	const findingLines = findings.map((finding) => `- [${finding.check}] ${finding.location} — ${finding.issue}\n  fix: ${finding.fix}`);
	const referenceLines = [
		`- Decisions record: ${decisionsPath}`,
		...(brainstormDecisionsPath ? [`- Brainstorm decisions (settled during brainstorm, before planning began): ${brainstormDecisionsPath}`] : []),
		`- Verified facts: ${factsPath}`,
	];
	const sections = [
		`# Repair input`,
		`## Plan files to repair (Edit in place)\n\n- ${planPaths.join('\n- ')}`,
		`## Structural findings to resolve\n\n${findingLines.join('\n')}`,
		`## Reference files (Read on demand)\n\n${referenceLines.join('\n')}`,
		'Remember: minimal edits resolving only the flagged findings, then your entire final message must be exactly one JSON PlanFixReport object — nothing else.',
	];

	return {
		systemPrompt: planRepairPrompt,
		prompt: sections.join('\n\n'),
	};
};
