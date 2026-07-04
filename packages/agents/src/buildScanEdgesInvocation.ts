import scanEdgesPrompt from '../prompts/scanEdges.md';

interface Params {
	node: string;
	/** Local clone directory holding the node's code (repo root). */
	workspace: string;
	/** Monorepo package subpath; undefined for whole-repo nodes. */
	scope?: string;
}

/** Assemble one scan-edges invocation deterministically. */
export const buildScanEdgesInvocation = ({ node, workspace, scope }: Params) => ({
	systemPrompt: scanEdgesPrompt,
	prompt: [
		`# Scan input`,
		[`- node: ${node}`, `- workspace: ${workspace}`, `- scope: ${scope ?? 'null (whole repo)'}`].join('\n'),
		'Remember: your entire final message must be exactly one JSON inventory object — nothing else.',
	].join('\n\n'),
});
