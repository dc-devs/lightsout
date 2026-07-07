import { isAbsolute, join } from 'node:path';
import { readConnectionMap } from '../../readConnectionMap';
import { readNodeRegistry } from '../../readNodeRegistry';

interface Params {
	cwd: string;
	/** Connection-docs directory, cwd-relative or absolute. */
	connectionsDir: string;
}

interface ConnectionGraph {
	/** The resolved absolute connections directory. */
	mapDir: string;
	edges: Awaited<ReturnType<typeof readConnectionMap>>;
	registry: Awaited<ReturnType<typeof readNodeRegistry>>;
}

/**
 * Resolve the connections directory and read the map's two halves — the edge
 * docs and the node registry (repos.yaml). Shared by the traverse and debug
 * loops and the anchor-verification sweep, which all open the map this way.
 */
export const readConnectionGraph = async ({ cwd, connectionsDir }: Params): Promise<ConnectionGraph> => {
	const mapDir = isAbsolute(connectionsDir) ? connectionsDir : join(cwd, connectionsDir);
	const edges = await readConnectionMap({ connectionsDir: mapDir });
	const registry = await readNodeRegistry({ connectionsDir: mapDir });

	return { mapDir, edges, registry };
};
