import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultCodeStandards } from '@/standards/defaultCodeStandards';
import { defaultTestStandards } from '@/standards/defaultTestStandards';

/** Reserved entries that resolve to the engine's bundled default docs (per-channel) instead of files. */
const tokens: Record<string, Record<string, string>> = {
	'lightsout:code-defaults': defaultCodeStandards,
	'lightsout:test-defaults': defaultTestStandards,
};

interface Params {
	cwd: string;
	paths: string[];
	/** Active framework channels (e.g. 'react', 'tanstack') — bundled tokens expand to base + these. */
	channels?: string[];
}

/**
 * Every markdown file under `dir`, recursively, as display paths under the
 * config entry as written, in lexicographic order — the same walk and
 * ordering `tools/generateStandardsBarrels.ts` builds the bundled defaults
 * with, so a folder entry and the bundled docs agree. Symlinks inside the
 * tree are neither followed nor collected, matching that generator's `find`.
 */
const listMarkdownFiles = async ({ dir, prefix }: { dir: string; prefix: string }) => {
	const files: string[] = [];

	const walk = async ({ current, displayPath }: { current: string; displayPath: string }) => {
		const entries = await readdir(current, { withFileTypes: true });

		for (const entry of entries) {
			const entryDisplayPath = `${displayPath}/${entry.name}`;

			if (entry.isDirectory()) {
				await walk({ current: join(current, entry.name), displayPath: entryDisplayPath });
				continue;
			}

			if (entry.isFile() && entry.name.endsWith('.md')) {
				files.push(entryDisplayPath);
			}
		}
	};

	await walk({ current: dir, displayPath: prefix.replace(/\/$/, '') });

	return files.sort();
};

/**
 * Load standards for inlining into agent invocations. Each entry is either a
 * reserved token (`lightsout:code-defaults` / `lightsout:test-defaults` — the
 * docs bundled from this repo's standards/ folders, base channel plus any
 * active framework channels), a repo-relative markdown file, or a
 * repo-relative folder (every `.md` under it, recursively, in sorted path
 * order). A declared-but-missing entry — or a folder holding no markdown at
 * all — is a hard error: running without standards the consumer asked for
 * would produce silently non-conformant code, which is worse than not
 * running.
 */
export const readStandards = async ({ cwd, paths, channels = [] }: Params): Promise<string | undefined> => {
	if (paths.length === 0) {
		return undefined;
	}

	const contents = await Promise.all(
		paths.map(async (path) => {
			const bundled = tokens[path];

			if (bundled) {
				return [bundled.base, ...channels.map((channel) => bundled[channel])].filter(Boolean).join('\n\n');
			}

			const absolutePath = join(cwd, path);
			const stats = await stat(absolutePath).catch(() => {
				throw new Error(`standards file not found: ${absolutePath}`);
			});

			if (stats.isDirectory()) {
				const files = await listMarkdownFiles({ dir: absolutePath, prefix: path });

				if (files.length === 0) {
					throw new Error(`standards folder contains no markdown files: ${absolutePath}`);
				}

				const docs = await Promise.all(
					files.map(async (file) => `<!-- ${file} -->\n${await readFile(join(cwd, file), 'utf8')}`),
				);

				return docs.join('\n\n');
			}

			const raw = await readFile(absolutePath, 'utf8');

			return `<!-- ${path} -->\n${raw}`;
		}),
	);

	return contents.join('\n\n');
};
