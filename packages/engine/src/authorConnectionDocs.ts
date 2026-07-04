import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { MapJoin } from '@lightsout/contracts';
import { regenerateConnectionIndex } from './regenerateConnectionIndex';

const frontmatterPattern = /^---\n([\s\S]*?)\n---/;
const slugOf = (key: string) => key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'edge';

/** Rewrite one doc's frontmatter in place, preserving its body. */
const patchDoc = async ({ path, patch }: { path: string; patch: (raw: Record<string, unknown>) => void }) => {
	const text = await readFile(path, 'utf8');
	const match = text.match(frontmatterPattern);

	if (!match?.[1]) {
		throw new Error(`${path} has no frontmatter to patch`);
	}

	const raw = parse(match[1]) as Record<string, unknown>;

	patch(raw);
	await writeFile(path, text.replace(frontmatterPattern, `---\n${stringify(raw).trimEnd()}\n---`), 'utf8');
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
		}).trimEnd();
		const body = ['# Summary', '', `${edge.from} → ${edge.to} via ${edge.matchKey}: ${edge.fromSighting.payload}`];

		await writeFile(join(connectionsDir, `${id}.md`), `---\n${frontmatter}\n---\n\n${body.join('\n')}\n`, 'utf8');
		authored.push(id);
	}

	for (const entry of reviewedJoin.confirmed) {
		await patchDoc({
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
		await patchDoc({
			path: join(connectionsDir, `${entry.doc}.md`.replace(/\.md\.md$/, '.md')),
			patch: (raw) => {
				raw[`${entry.side}-anchor`] = { path: entry.foundAt.split(':')[0], pattern: entry.pattern };
			},
		});
	}

	const { edgeCount } = await regenerateConnectionIndex({ connectionsDir });

	return { authored, confirmed: reviewedJoin.confirmed.length, repaired: reviewedJoin.drifted.length, edgeCount };
};
