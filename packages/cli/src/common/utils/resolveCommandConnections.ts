import type { LightsoutConfig } from '@lightsout/contracts';
import { resolveConnectionsSource } from '@lightsout/engine';
import { getStringFlag } from '../args/getStringFlag';
import { dim } from '../terminal/dim';

interface Params {
	cwd: string;
	flags: Map<string, string | true>;
	config: LightsoutConfig | undefined;
}

/**
 * The shared connections-source resolution used by traverse, debug, build-map,
 * and map-connection: the --connections flag, else the configured dir, else the
 * default; resolve it and announce a remote map clone. Returns the raw source
 * (build-map echoes it in its --author hint) alongside the resolved handle.
 */
export const resolveCommandConnections = async ({
	cwd,
	flags,
	config,
}: Params): Promise<{ source: string; connections: Awaited<ReturnType<typeof resolveConnectionsSource>> }> => {
	const source = getStringFlag({ flags, name: 'connections' }) ?? config?.traverse?.connections ?? '.lightsout/connections';
	const connections = await resolveConnectionsSource({ cwd, source });

	if (connections.remote) {
		console.log(dim(`map: ${connections.repo} → ${connections.dir}`));
	}

	return { source, connections };
};
