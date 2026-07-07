import type { ConnectionDoc, DebugTraceState } from '@lightsout/contracts';

interface Params {
	state: DebugTraceState;
	next: DebugTraceState['frontier'][number];
	key: string;
	edges: Map<string, ConnectionDoc>;
	enqueue: (entry: DebugTraceState['frontier'][number]) => void;
	progress: (message: string) => void;
}

/**
 * Cross a non-repo node (AWS service, external system): no code to
 * investigate, so mark it visited and continue in the same direction along
 * every edge that leaves it — no agent, no budget spent.
 */
export const crossNonRepoNode = ({ state, next, key, edges, enqueue, progress }: Params): void => {
	state.visited.push(key);
	state.hops.push({ node: next.node, viaEdge: next.viaEdge, direction: next.direction, note: 'non-repo node — no code to investigate; crossed mechanically' });

	for (const [id, doc] of edges) {
		const onward = next.direction === 'downstream' ? doc.from === next.node : doc.to === next.node;

		if (onward) {
			enqueue({
				node: next.direction === 'downstream' ? doc.to : doc.from,
				viaEdge: id,
				direction: next.direction,
				hypothesis: next.hypothesis,
				reason: `continues ${next.direction} of non-repo node ${next.node}`,
			});
		}
	}

	progress(`hop —: ${next.node} (non-repo node, crossed mechanically)`);
};
