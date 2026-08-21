import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

/**
 * Names a build tool writes its output under, skipped only OUTSIDE a `src`
 * folder.
 *
 * By name alone this list is a guess, and it was wrong: jest writes coverage
 * reports to `coverage/`, and skipping that name everywhere also hid
 * `packages/engine/src/coverage/` — nineteen files of the engine's own coverage
 * pipeline — from every standards rule, silently, because a walk that lists
 * fewer files reports fewer findings rather than an error.
 *
 * Position is what separates the two: a build tool writes beside `src`, never
 * inside it. A repo whose output lands somewhere this cannot guess names that
 * path in the config's `generated` list, which the walk already honours.
 */
const buildOutputDirs = new Set(['dist', 'build', 'coverage', 'out']);
const sourceExtension = /\.(m|c)?[jt]sx?$/;

interface Params {
	cwd: string;
	/** Repo-relative path prefixes to exclude (the config's `generated` list). */
	exclude?: string[];
}

/**
 * All JS/TS source files under cwd, repo-relative, skipping dot/dependency/
 * build dirs, declaration files, and the consumer's declared generated
 * paths. Test files ARE included — callers that must ignore them
 * (duplication tiers, per the contract-pinning doctrine) filter with
 * `isTestFile`.
 *
 * Build output is skipped by name only outside a `src` folder — see
 * `buildOutputDirs` for what that cost when it was skipped everywhere.
 *
 * A standards package's fixtures are skipped too. Inside a package — a tree
 * rooted at `lightsout-standards.json` — a `fixtures/` folder holds the
 * deliberately-shaped samples a check is run against, and the failing side is
 * written to violate the very rule it proves. Listing them as source makes a
 * package's own counter-examples read as the repo's faults, and there is no
 * prefix a consumer could exclude them with: they sit one folder deep inside
 * every rule. The pruning is by directory, so a walk that starts inside a
 * fixture side still lists it — which is how `standards-validate` runs a
 * check against one.
 *
 * The package roots the walk passed are reported alongside the files, because
 * finding them is what the walk already did and no caller can cheaply repeat
 * it: `isTestFile` needs them to know that a `tests/` folder inside a package
 * names a document set rather than a directory of tests.
 */
export const listSourceFiles = async ({ cwd, exclude = [] }: Params): Promise<{ files: string[]; standardsPackages: string[] }> => {
	const files: string[] = [];
	const standardsPackages: string[] = [];
	// The file whose presence declares a folder a standards package root.
	const standardsPackageRootFile = 'lightsout-standards.json';
	// Inside such a package, the folder holding a rule's pass/fail samples.
	const fixturesDir = 'fixtures';

	const walk = async (dir: string, insideStandardsPackage: boolean, insideSource: boolean) => {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		const isPackageRoot = !insideStandardsPackage && entries.some((entry) => entry.name === standardsPackageRootFile);
		const insidePackage = insideStandardsPackage || isPackageRoot;

		if (isPackageRoot) {
			standardsPackages.push(relative(cwd, dir));
		}

		for (const entry of entries) {
			// 'node_modules' is skipped at any depth — a dependency tree is never source.
			if (entry.name.startsWith('.') || entry.name === 'node_modules' || (!insideSource && buildOutputDirs.has(entry.name))) {
				continue;
			}

			const path = join(dir, entry.name);

			if (entry.isDirectory()) {
				if (insidePackage && entry.name === fixturesDir) {
					continue;
				}

				await walk(path, insidePackage, insideSource || entry.name === 'src');
				continue;
			}

			const rel = relative(cwd, path);

			if (!sourceExtension.test(entry.name) || entry.name.endsWith('.d.ts')) {
				continue;
			}

			if (exclude.some((prefix) => rel.startsWith(prefix.replace(/\/$/, '')))) {
				continue;
			}

			files.push(rel);
		}
	};

	await walk(cwd, false, false);

	return { files: files.sort(), standardsPackages: standardsPackages.sort() };
};
