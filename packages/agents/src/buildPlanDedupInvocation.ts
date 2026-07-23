import planDedupPrompt from '../prompts/planDedup.md';

/** One detected name collision — a plain shape so the agents package stays free of an engine dependency (structurally a `PriorArtCandidate`). */
interface Candidate {
	plannedSymbol: string;
	collidesWith: Array<{ name: string; path: string }>;
}

interface Params {
	/** The plan text to judge for prior-art duplication. */
	planText: string;
	/** Overview plan text — context for a phased plan, never judged standalone. */
	overviewText?: string;
	/** The engine's deterministically-detected name collisions the judge rules on. */
	candidates: Candidate[];
	/** Supplemental code standards, inlined verbatim. */
	standards?: string;
}

/** Render one detected collision as a markdown bullet with its colliding exports. */
const renderCandidate = ({ plannedSymbol, collidesWith }: Candidate) => {
	const collisions = collidesWith.map((collision) => `${collision.name} → ${collision.path}`).join('; ');

	return `- \`${plannedSymbol}\` collides with: ${collisions}`;
};

/**
 * Assemble one plan dedup-judge invocation deterministically. The overview and
 * the standards are stable across a run's judgments, so they live in the system
 * prompt the harness caches through; the plan text and detected collisions are
 * the per-invocation prompt.
 */
export const buildPlanDedupInvocation = ({ planText, overviewText, candidates, standards }: Params): { systemPrompt: string; prompt: string } => {
	const roleSections = [planDedupPrompt];

	if (overviewText) {
		roleSections.push(`# Overview (context only — do not judge standalone)\n\n${overviewText}`);
	}

	if (standards) {
		roleSections.push(`# Code standards\n\nThe implementing agent loads these too — factor them into extract/reuse recommendations:\n\n${standards}`);
	}

	const sections = [
		`# Dedup input`,
		`## Plan to judge\n\n${planText}`,
		`## Detected name collisions\n\n${candidates.map(renderCandidate).join('\n')}`,
		'Remember: your entire final message must be exactly one JSON DedupJudgment object — nothing else.',
	];

	return {
		systemPrompt: roleSections.join('\n\n---\n\n'),
		prompt: sections.join('\n\n'),
	};
};
