import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

/** The `export const` names a source declares — what its consumer has to name to consume it. */
const exportedNames = ({ source }: { source: string }) => [...source.matchAll(/export const (\w+)/g)].map(([, name]) => name);

/**
 * The consumer beside a source file: `src/feature.js` is used by
 * `src/useFeature.js`. One consumer per module rather than one shared entry,
 * because a shared entry would import every module in the repo and so make
 * every pair of files related — which is the exact question the writer-grouping
 * tests ask.
 */
const consumerFor = ({ path }: { path: string }) => {
	const extension = extname(path);
	const name = basename(path, extension);

	return join(dirname(path), `use${name.charAt(0).toUpperCase()}${name.slice(1)}${extension}`)
		.split('\\')
		.join('/');
};

/**
 * Write a source file into a fixture repo, with a consumer that uses it.
 *
 * A fixture repo is checked by the real standards checks, several of which ask
 * whether anything consumes an export. A file dropped in on its own answers no
 * to all of them and arrives as findings the test never planted, so writing a
 * module and using it are the same act and this is it. It is also what the
 * thing being stubbed does: an agent adding a module wires it into a caller.
 *
 * The consumer exports nothing itself, which is what stops the chain — the
 * question "what consumes this?" has to have a last answer somewhere.
 */
export const writeSource = ({ dir, path, source }: { dir: string; path: string; source: string }): void => {
	mkdirSync(join(dir, dirname(path)), { recursive: true });
	writeFileSync(join(dir, path), source);

	const names = exportedNames({ source });

	if (names.length === 0) {
		return;
	}

	const specifier = `./${basename(path)}`;

	writeFileSync(join(dir, consumerFor({ path })), `import { ${names.join(', ')} } from '${specifier}';\n\nconsole.log(${names.join(', ')});\n`);
};
