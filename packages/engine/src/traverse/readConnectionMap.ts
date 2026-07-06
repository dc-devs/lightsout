import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ConnectionDoc } from '@lightsout/contracts';
import { frontmatterPattern } from './common/constants/frontmatterPattern';

interface Params {
	/** Directory of connection docs (one `<from>--<to>--<label>.md` per edge). */
	connectionsDir: string;
}

/**
 * Parse every connection doc in the map. The docs directory itself is the
 * routing table — INDEX.md is a human convenience the engine never trusts.
 * A doc that fails its frontmatter contract is a hard error naming the file:
 * a silently dropped edge would read as "no route" and dead-end traversals.
 */
export const readConnectionMap = async ({ connectionsDir }: Params) => {
	const entries = await readdir(connectionsDir).catch(() => {
		throw new Error(`connections directory not found: ${connectionsDir}`);
	});
	const edges = new Map<string, ConnectionDoc>();

	for (const name of entries.filter((entry) => entry.endsWith('.md') && entry !== 'README.md' && entry !== 'INDEX.md')) {
		const text = await readFile(join(connectionsDir, name), 'utf8');
		const frontmatter = text.match(frontmatterPattern)?.[1];

		if (!frontmatter) {
			throw new Error(`connection doc ${name} has no frontmatter`);
		}

		const parsed = ConnectionDoc.safeParse(parse(frontmatter));

		if (!parsed.success) {
			throw new Error(`connection doc ${name} failed its contract: ${parsed.error.message}`);
		}

		edges.set(name.replace(/\.md$/, ''), parsed.data);
	}

	return edges;
};
