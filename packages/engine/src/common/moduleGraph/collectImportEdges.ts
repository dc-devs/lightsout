import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type ts from 'typescript';
import { createSpecifierResolver } from '#src/common/moduleGraph/createSpecifierResolver.ts';

interface Params {
	cwd: string;
	/** Repo-relative source files — the ONLY resolution universe; imports landing outside it are simply not edges. */
	files: string[];
	/** The consumer's TypeScript module (resolveConsumerTypescript). */
	compiler: typeof ts;
}

/**
 * Import edges among the caller's files. An import is a language fact, so
 * this stays born-generic: no tsconfig, no alias tables, no architecture
 * conventions — specifiers resolve only against the caller's file set, and
 * every unresolvable or ambiguous specifier is a missing edge, which only
 * splits groups further (degrading toward per-file fan-out, never toward a
 * wrong grouping). `preProcessFile` lists specifiers without type-checking,
 * so the whole pass costs file reads, not a compile.
 */
export const collectImportEdges = async ({ cwd, files, compiler }: Params): Promise<Array<{ from: string; to: string }>> => {
	const resolve = createSpecifierResolver({ files });
	const edges: Array<{ from: string; to: string }> = [];

	for (const from of files) {
		const content = await readFile(join(cwd, from), 'utf8').catch(() => undefined);

		if (content === undefined) {
			continue;
		}

		const specifiers = [...new Set(compiler.preProcessFile(content, true, true).importedFiles.map((imported) => imported.fileName))];

		for (const specifier of specifiers) {
			const to = resolve({ from, specifier });

			if (to !== undefined && to !== from) {
				edges.push({ from, to });
			}
		}
	}

	return edges;
};
