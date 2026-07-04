import traverseHopPrompt from '../prompts/traverseHop.md';

interface Params {
	node: string;
	/** Local clone directory holding the node's code (repo root). */
	workspace: string;
	/** Monorepo package subpath; undefined for whole-repo nodes. */
	scope?: string;
	entryAnchor: { path: string; pattern: string };
	question: string;
	dataOfInterest: string;
	/** Absolute paths of additional-context docs resolved into the workspace. */
	contextDocs?: string[];
}

/** Assemble one traverse-hop invocation deterministically. */
export const buildTraverseHopInvocation = ({ node, workspace, scope, entryAnchor, question, dataOfInterest, contextDocs }: Params) => {
	const sections = [
		`# Hop input`,
		[
			`- node: ${node}`,
			`- workspace: ${workspace}`,
			`- scope: ${scope ?? 'null (whole repo)'}`,
			`- entry anchor: ${entryAnchor.path} — pattern: ${entryAnchor.pattern}`,
			`- question: ${question}`,
			`- data of interest: ${dataOfInterest}`,
		].join('\n'),
	];

	if (contextDocs && contextDocs.length > 0) {
		sections.push(`# Context docs — read these first\n\n${contextDocs.map((doc) => `- ${doc}`).join('\n')}`);
	}

	sections.push('Remember: your entire final message must be exactly one JSON report object — nothing else.');

	return {
		systemPrompt: traverseHopPrompt,
		prompt: sections.join('\n\n'),
	};
};
