import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import type { EdgeOperation, MapJoin } from '@lightsout/contracts';
import { patchConnectionDoc } from './patchConnectionDoc';
import { regenerateConnectionIndex } from './regenerateConnectionIndex';

const slugOf = (key: string) => key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'edge';

/**
 * A multiplexed edge's operations, rendered as generated evidence — the
 * verified traffic (sighted on both sides) grouped by type so it reads as a
 * few scannable groups, not a wall (decision B), followed by a drift section
 * when the two sides disagree. Regenerated from the join on every author,
 * never hand-maintained, so it can't rot.
 */
const renderOperations = (operations: EdgeOperation[], drift: MapJoin['matched'][number]['operationDrift']): string[] => {
	const groups = new Map<string, string[]>();

	for (const op of operations) {
		const key = op.type ?? 'other';

		groups.set(key, [...(groups.get(key) ?? []), op.name]);
	}

	const lines = [`## Operations (${operations.length})`, '', '_Generated from the scan — verified traffic (called by the caller AND exposed by the handler)._', ''];

	for (const [type, names] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		lines.push(`**${type}** (${names.length}): ${[...names].sort((a, b) => a.localeCompare(b)).join(', ')}`, '');
	}

	if (drift.callerOnly.length > 0 || drift.handlerOnlyCount > 0) {
		lines.push('### Drift', '');

		if (drift.callerOnly.length > 0) {
			lines.push(`- **${drift.callerOnly.length} called but not exposed** by the handler (possible rename/removal — review): ${drift.callerOnly.join(', ')}`, '');
		}

		if (drift.handlerOnlyCount > 0) {
			lines.push(`- ${drift.handlerOnlyCount} exposed by the handler but not called here (unused surface).`, '');
		}
	}

	return lines;
};

interface Params {
	connectionsDir: string;
	/** The REVIEWED join — the user has already culled it (deleted rejected entries from join.json). */
	join: MapJoin;
	/** scannedSha per node, from the inventories that produced the join. */
	shaByNode: Map<string, string>;
}

/**
 * The post-review author step (prototype decision T14: no doc is written
 * before a human culls the join). Matched edges become docs whose anchors
 * come straight from the code-verified sightings; confirmed docs get their
 * last-verified-sha advanced; drifted docs get the disagreeing anchor
 * repaired to where the sighting actually found it. INDEX.md regenerates
 * from the resulting doc set. Everything here is mechanical — the only
 * judgment fields (summary wording, additional-context) stay minimal and
 * empty respectively.
 */
export const authorConnectionDocs = async ({ connectionsDir, join: reviewedJoin, shaByNode }: Params) => {
	const authored: string[] = [];

	for (const edge of reviewedJoin.matched) {
		const id = `${edge.from}--${edge.to}--${slugOf(edge.matchKey)}`;
		const frontmatter = stringify({
			from: edge.from,
			to: edge.to,
			type: edge.kind,
			'from-anchor': { path: edge.fromSighting.at.split(':')[0], pattern: edge.fromSighting.pattern },
			'to-anchor': { path: edge.toSighting.at.split(':')[0], pattern: edge.toSighting.pattern },
			...(edge.fromSighting.schemaAt || edge.toSighting.schemaAt
				? { schema: { ...(edge.fromSighting.schemaAt ? { from: edge.fromSighting.schemaAt } : {}), ...(edge.toSighting.schemaAt ? { to: edge.toSighting.schemaAt } : {}) } }
				: {}),
			'last-verified-sha': {
				[edge.from]: shaByNode.get(edge.from) ?? null,
				[edge.to]: shaByNode.get(edge.to) ?? null,
			},
			'additional-context': [],
			...(edge.operations.length > 0 ? { operations: edge.operations } : {}),
		}).trimEnd();
		const body = [
			'# Summary',
			'',
			`${edge.from} → ${edge.to} via ${edge.matchKey}: ${edge.fromSighting.payload}`,
			...(edge.operations.length > 0 || edge.operationDrift.callerOnly.length > 0 ? ['', ...renderOperations(edge.operations, edge.operationDrift)] : []),
		];

		await writeFile(join(connectionsDir, `${id}.md`), `---\n${frontmatter}\n---\n\n${body.join('\n')}\n`, 'utf8');
		authored.push(id);
	}

	for (const entry of reviewedJoin.confirmed) {
		await patchConnectionDoc({
			path: join(connectionsDir, `${entry.doc}.md`.replace(/\.md\.md$/, '.md')),
			patch: (raw) => {
				const from = raw['from'] as string;
				const to = raw['to'] as string;

				raw['last-verified-sha'] = {
					[from]: shaByNode.get(from) ?? (raw['last-verified-sha'] as Record<string, unknown> | undefined)?.[from] ?? null,
					[to]: shaByNode.get(to) ?? (raw['last-verified-sha'] as Record<string, unknown> | undefined)?.[to] ?? null,
				};
			},
		});
	}

	for (const entry of reviewedJoin.drifted) {
		await patchConnectionDoc({
			path: join(connectionsDir, `${entry.doc}.md`.replace(/\.md\.md$/, '.md')),
			patch: (raw) => {
				raw[`${entry.side}-anchor`] = { path: entry.foundAt.split(':')[0], pattern: entry.pattern };
			},
		});
	}

	const { edgeCount } = await regenerateConnectionIndex({ connectionsDir });

	return { authored, confirmed: reviewedJoin.confirmed.length, repaired: reviewedJoin.drifted.length, edgeCount };
};
