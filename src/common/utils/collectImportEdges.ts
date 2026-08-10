import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type ts from 'typescript';

interface Params {
	cwd: string;
	/** Repo-relative changed source files — the ONLY resolution universe; imports landing outside it are simply not edges. */
	files: string[];
	/** The consumer's TypeScript module (resolveConsumerTypescript). */
	compiler: typeof ts;
}

const stripExtension = (path: string) => path.replace(/\.(m|c)?[jt]sx?$/i, '');

/**
 * Import edges among the changed files. An import is a language fact, so
 * this stays born-generic: no tsconfig, no alias tables, no architecture
 * conventions — specifiers resolve only against the changed-file set, and
 * every unresolvable or ambiguous specifier is a missing edge, which only
 * splits groups further (degrading toward per-file fan-out, never toward a
 * wrong grouping). `preProcessFile` lists specifiers without type-checking,
 * so the whole pass costs file reads, not a compile.
 */
export const collectImportEdges = async ({ cwd, files, compiler }: Params) => {
	const byStripped = new Map<string, string>();

	for (const file of files) {
		byStripped.set(stripExtension(file), file);
	}

	const probe = (stripped: string) => byStripped.get(stripped) ?? byStripped.get(`${stripped}/index`);

	const resolveRelative = ({ from, specifier }: { from: string; specifier: string }) =>
		probe(posix.normalize(posix.join(posix.dirname(from), stripExtension(specifier))));

	// Aliased specifiers (`@/x/y`, `@scope/pkg/src/x`) resolve by unique path
	// suffix: drop leading segments one tier at a time; the first tier with
	// exactly one changed-file match wins. Multiple matches are ambiguous —
	// no edge. Single-segment specifiers (external packages like `react`)
	// never reach a matchable tier.
	const resolveBySuffix = ({ specifier }: { specifier: string }) => {
		const segments = stripExtension(specifier).split('/');

		for (let start = 1; start < segments.length; start += 1) {
			const suffix = segments.slice(start).join('/');
			const matches = [...byStripped.keys()].filter(
				(stripped) => stripped === suffix || stripped.endsWith(`/${suffix}`) || stripped === `${suffix}/index` || stripped.endsWith(`/${suffix}/index`),
			);

			if (matches.length > 1) {
				return undefined;
			}

			if (matches.length === 1 && matches[0] !== undefined) {
				return byStripped.get(matches[0]);
			}
		}

		return undefined;
	};

	const edges: Array<{ from: string; to: string }> = [];

	for (const from of files) {
		const content = await readFile(join(cwd, from), 'utf8').catch(() => undefined);

		if (content === undefined) {
			continue;
		}

		const specifiers = [...new Set(compiler.preProcessFile(content, true, true).importedFiles.map((imported) => imported.fileName))];

		for (const specifier of specifiers) {
			const to = specifier.startsWith('.') ? resolveRelative({ from, specifier }) : resolveBySuffix({ specifier });

			if (to !== undefined && to !== from) {
				edges.push({ from, to });
			}
		}
	}

	return edges;
};
