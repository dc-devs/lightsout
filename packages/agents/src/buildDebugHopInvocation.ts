import debugHopPrompt from '../prompts/debugHop.md';

interface Params {
	node: string;
	/** Local workspace holding the node's code — the dev's working tree on the seed hop, a full-history clone otherwise. */
	workspace: string;
	/** Monorepo package subpath; undefined for whole-repo nodes. */
	scope?: string;
	symptoms: string;
	/** The current hypothesis, refined from earlier hops. */
	hypothesis: string;
	/** Entry anchor from the connecting edge; undefined on the seed hop (investigate broadly). */
	entryAnchor?: { path: string; pattern: string };
	/** A commit worth checking first, e.g. from a "bug started <date>" report; undefined when none. */
	suspectCommit?: string;
	/** Absolute paths of context (connection) docs resolved into the workspace. */
	contextDocs?: string[];
}

/** Assemble one debug-hop invocation deterministically. */
export const buildDebugHopInvocation = ({ node, workspace, scope, symptoms, hypothesis, entryAnchor, suspectCommit, contextDocs }: Params) => {
	const sections = [
		`# Hop input`,
		[
			`- node: ${node}`,
			`- workspace: ${workspace}`,
			`- scope: ${scope ?? 'null (whole repo)'}`,
			`- entry anchor: ${entryAnchor ? `${entryAnchor.path} — pattern: ${entryAnchor.pattern}` : 'null (seed hop — investigate the node from the symptoms)'}`,
			`- suspect commit: ${suspectCommit ?? 'null'}`,
			`- symptoms: ${symptoms}`,
			`- hypothesis: ${hypothesis}`,
		].join('\n'),
	];

	if (contextDocs && contextDocs.length > 0) {
		sections.push(`# Context docs — read these first\n\n${contextDocs.map((doc) => `- ${doc}`).join('\n')}`);
	}

	sections.push('Remember: your entire final message must be exactly one JSON report object — nothing else.');

	return {
		systemPrompt: debugHopPrompt,
		prompt: sections.join('\n\n'),
	};
};
