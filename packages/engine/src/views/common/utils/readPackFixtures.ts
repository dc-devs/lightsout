import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FixtureSide, type StandardsPackFixture } from '#src/contracts/index.ts';

/** Every file under one side's root, as `/`-separated paths relative to it, sorted. */
const listSideFiles = async ({ root, prefix }: { root: string; prefix: string }) => {
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	const paths: string[] = [];

	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;

		if (entry.isDirectory()) {
			paths.push(...(await listSideFiles({ root: join(root, entry.name), prefix: path })));
		} else {
			paths.push(path);
		}
	}

	return paths;
};

interface Params {
	fixturesPath: string;
}

/**
 * Every file of a rule's proof, both sides, with the text each holds.
 *
 * The two sides are read recursively because they are real source trees rather
 * than single files: `type-assertion`'s pass side is a payload reader plus the
 * named-constant file it was carved out into, and a flat read would show the
 * first and silently drop the carve-out the fixture exists to demonstrate.
 *
 * A missing side — or no `fixtures` folder at all — yields no entries rather
 * than an error, the same stance `getPlanDocument` takes towards a deleted plan.
 * A built pack ships without its fixtures, and that is a normal state a page
 * renders as "shipped without its fixtures".
 *
 * @param fixturesPath - absolute path of the rule folder's `fixtures` folder, which holds `pass/` and `fail/`
 * @returns pass-side files first, then fail-side, each side in path order
 */
export const readPackFixtures = async ({ fixturesPath }: Params): Promise<StandardsPackFixture[]> => {
	const fixtures: StandardsPackFixture[] = [];

	for (const side of [FixtureSide.Pass, FixtureSide.Fail]) {
		const sideRoot = join(fixturesPath, side);

		for (const path of await listSideFiles({ root: sideRoot, prefix: '' })) {
			const text = await readFile(join(sideRoot, ...path.split('/')), 'utf8').catch(() => undefined);

			if (text !== undefined) {
				fixtures.push({ side, path, text });
			}
		}
	}

	return fixtures;
};
