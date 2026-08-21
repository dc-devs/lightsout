import { globSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { invokedDirectly } from './invokedDirectly.mjs';

/**
 * Do the deliberate copies still agree?
 *
 * A standards package ships as a bare directory beside the engine, with no
 * manifest and no `node_modules`, so every value it imports has to resolve
 * inside its own tree. That makes a handful of small definitions impossible to
 * share and necessary to duplicate — `isTestFile` above all, where the engine's
 * copy decides what counts as a test when it splits a file list, and the
 * package's copy re-asks the same question when a rule counts references. The
 * two disagreeing is not a compile error; it is a rule quietly applying to the
 * wrong files.
 *
 * Until now the only thing holding them together was a comment saying "change
 * one, change the other", which nothing read.
 *
 * A copy declares its twin with `@mirrors <repo-relative path>` in its
 * docblock. Both are parsed and re-printed WITHOUT comments before comparing,
 * because the prose around each copy is written for its own reader — the
 * engine's `isTestFile` explains what the exemption buys, the package's
 * explains which rules re-ask the question — and only the code has to match.
 *
 * What this does NOT cover: a pair that has to agree in BEHAVIOUR while
 * differing in code. `getExportName` is the one such pair — the package's copy
 * derives a base name itself where the engine's reaches for `node:path` — and
 * both copies say so. Nothing holds those two together but a reader.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every file declaring a twin, as [copy, twin] repo-relative pairs. */
const findDeclaredMirrors = () => {
	const pairs = [];

	for (const path of globSync('packages/*/**/*.ts', {
		cwd: repoRoot,
		exclude: (name) => name === 'node_modules' || name === 'coverage' || name === 'fixtures',
	})) {
		const twin = /@mirrors\s+(\S+)/.exec(readFileSync(join(repoRoot, path), 'utf8'))?.[1];

		if (twin !== undefined) {
			pairs.push([path.split(sep).join('/'), twin]);
		}
	}

	// Both copies name each other, so every pair turns up twice; the sorted key
	// makes the second sighting a duplicate rather than a second comparison.
	return [...new Map(pairs.map((pair) => [[...pair].sort().join(' ↔ '), pair])).values()];
};

/** One file's code with every comment dropped and the layout normalized, so only what runs is compared. */
const codeOf = ({ path }) => {
	const text = readFileSync(join(repoRoot, path), 'utf8');
	const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);

	return ts.createPrinter({ removeComments: true }).printFile(sourceFile);
};

/**
 * @returns every mirror that has drifted, and how many pairs were compared
 */
export const checkMirrors = () => {
	const pairs = findDeclaredMirrors();
	const problems = [];

	for (const [copy, twin] of pairs) {
		try {
			if (codeOf({ path: copy }) !== codeOf({ path: twin })) {
				problems.push(`${copy} and ${twin} declare each other a mirror, but their code differs`);
			}
		} catch {
			problems.push(`${copy} names ${twin} as its mirror, and that file cannot be read`);
		}
	}

	return { problems, compared: pairs.length };
};

const main = () => {
	const { problems, compared } = checkMirrors();

	if (problems.length === 0) {
		console.log(`${compared} declared mirror(s) agree`);

		return;
	}

	console.error('');

	for (const problem of problems) {
		console.error(`  ${problem}`);
	}

	console.error('');
	console.error('  These copies exist because a standards package cannot import from the engine.');
	console.error('  Reconcile them by hand — comments may differ, code may not.');
	console.error('');
	process.exitCode = 1;
};

if (invokedDirectly({ moduleUrl: import.meta.url })) {
	main();
}
