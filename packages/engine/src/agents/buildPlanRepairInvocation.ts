import { renderDocsSurfaces } from '#src/agents/common/utils/renderDocsSurfaces.ts';
import planRepairPrompt from '#src/agents/prompts/planRepair.md';
import type { ConfigDocs, StructuralFinding } from '#src/contracts/index.ts';

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
	/** The repository's declared documentation surfaces. Absent when it declares none. */
	docs?: ConfigDocs;
}

/**
 * The repairer's brief on the surfaces this repository declared. A missing
 * `## Documentation` heading is now one of the findings it resolves, and its
 * role prompt forbids inventing a section's content — so an unbriefed repairer
 * either breaks that rule or fails the draft.
 */
const documentationSection = ({ docs }: { docs: ConfigDocs }) =>
	`## Documentation surfaces

This repository declares the documents below. A \`## Documentation\` section
states either the declared documents the plan touches, each in a backticked
span and each also listed under one of the plan's file headings, or the exact
sentence \`Nothing user-facing — no docs needed.\` Decide which from what the
plan already says it builds; do not invent a document.

${renderDocsSurfaces({ docs })}`;

/**
 * Assemble one draft-repair invocation deterministically: the findings (with
 * their exact fix strings), the plan file paths to edit in place, and the
 * facts/decisions as *paths* the repairer Reads only when a fix requires their
 * content — the common mechanical repair never pays for them. The plan
 * template is deliberately absent — the repair role edits, never re-authors.
 *
 * A repository declaring no documentation surfaces gets a byte-identical
 * invocation to the one it got before the key existed.
 */
export const buildPlanRepairInvocation = ({
	findings,
	planPaths,
	decisionsPath,
	brainstormDecisionsPath,
	factsPath,
	docs,
}: Params): { systemPrompt: string; prompt: string } => {
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
		...(docs && docs.length > 0 ? [documentationSection({ docs })] : []),
		`## Reference files (Read on demand)\n\n${referenceLines.join('\n')}`,
		'Remember: minimal edits resolving only the flagged findings, then your entire final message must be exactly one JSON PlanFixReport object — nothing else.',
	];

	return {
		systemPrompt: planRepairPrompt,
		prompt: sections.join('\n\n'),
	};
};
