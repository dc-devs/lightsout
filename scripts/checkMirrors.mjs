import { globSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
 * A pair that has to agree in BEHAVIOUR while differing in code is held the
 * other way: `behaviouralMirrors` runs both copies against the same inputs and
 * compares what they return. `getExportName` is the one such pair — the
 * package's copy derives a base name itself where the engine's reaches for
 * `node:path` — so no comparison of code could ever hold it.
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

/**
 * Pairs that must agree in what they RETURN while differing in what they say.
 *
 * The inputs stay inside the contract both copies document — repo-relative,
 * `/`-separated, or a bare filename. Feeding a Windows separator would split
 * them for a reason neither promises to handle, which is a difference invented
 * by the test rather than one a caller could hit.
 */
const behaviouralMirrors = [
	{
		name: 'getExportName',
		left: 'packages/engine/src/plan/common/naming/getExportName.ts',
		right: 'packages/standards-typescript/common/naming/getExportName.ts',
		export: 'getExportName',
		inputs: [
			'index.ts',
			'src/plan/runPlanDraft.ts',
			'a/b/Component.tsx',
			'a/b/module.mjs',
			'a/b/module.cjs',
			'legacy/script.js',
			'legacy/View.jsx',
			'types/Config.d.ts',
			'name.with.dots.ts',
			'no-extension',
			'deep/nested/path/getExportName.ts',
			'.hidden.ts',
			'',
		].map((path) => ({ path })),
	},
];

/** Run both copies of a behavioural pair over its inputs, reporting the first input they answer differently. */
const compareBehaviour = async ({ pair }) => {
	const [left, right] = await Promise.all([import(pathToFileURL(join(repoRoot, pair.left)).href), import(pathToFileURL(join(repoRoot, pair.right)).href)]);

	for (const input of pair.inputs) {
		const [leftAnswer, rightAnswer] = [left[pair.export](input), right[pair.export](input)];

		if (leftAnswer !== rightAnswer) {
			return `${pair.left} and ${pair.right} must agree, but for ${JSON.stringify(input)} they return ${JSON.stringify(leftAnswer)} and ${JSON.stringify(rightAnswer)}`;
		}
	}

	return undefined;
};

/** One file's code with every comment dropped and the layout normalized, so only what runs is compared. */
const codeOf = ({ path }) => {
	const text = readFileSync(join(repoRoot, path), 'utf8');
	const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);

	return ts.createPrinter({ removeComments: true }).printFile(sourceFile);
};

/**
 * @returns every mirror that has drifted, how many code pairs were compared, and how many behavioural pairs
 */
export const checkMirrors = async () => {
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

	for (const pair of behaviouralMirrors) {
		try {
			const difference = await compareBehaviour({ pair });

			if (difference !== undefined) {
				problems.push(difference);
			}
		} catch (error) {
			problems.push(`the ${pair.name} behavioural mirror could not be run — ${error.message}`);
		}
	}

	return { problems, compared: pairs.length, comparedByBehaviour: behaviouralMirrors.length };
};

const main = async () => {
	const { problems, compared, comparedByBehaviour } = await checkMirrors();

	if (problems.length === 0) {
		console.log(`${compared} declared mirror(s) and ${comparedByBehaviour} behavioural pair(s) agree`);

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
	await main();
}
