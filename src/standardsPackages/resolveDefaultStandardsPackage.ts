import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

interface Params {
	/** Where to start walking up. Defaults to the directory of the running engine bundle. */
	startDir?: string;
}

/**
 * Locate the default standards package the plugin ships — a real folder next to
 * the bundled program, loaded from disk exactly like a third-party package, so
 * "the defaults load through the same path" is literally true.
 *
 * Walks up from the running program, accepting the installed layout
 * (`<plugin>/dist/` beside `<plugin>/standards/`) or this repo's dev layout
 * (`plugin/standards/`, the committed copy `pnpm bundle` writes from the
 * authored `standards/` at the repo root). A repo whose copy has not been
 * built yet falls through to that root folder, since the walk also accepts a
 * bare `standards/`. Synchronous because it runs once per process.
 *
 * The start directory comes from `process.argv[1]` — the engine is always
 * invoked as `node <plugin>/dist/cli.mjs`, so that is the bundle's own path.
 *
 * @param startDir - override the walk's starting directory
 * @throws {Error} When no packaged standards folder exists above the starting directory.
 */
export const resolveDefaultStandardsPackage = ({ startDir }: Params = {}): string => {
	const entryPoint = process.argv[1];
	let current = resolve(startDir ?? (entryPoint === undefined ? process.cwd() : dirname(entryPoint)));
	let found: string | undefined;

	while (found === undefined) {
		const candidates = [join(current, 'standards'), join(current, 'plugin', 'standards')];

		found = candidates.find((candidate) => existsSync(join(candidate, 'lightsout-standards.json')));

		const parent = dirname(current);

		if (found === undefined && parent === current) {
			throw new Error(`bundled default standards not found next to the engine (searched upward from ${current})`);
		}

		current = parent;
	}

	return found;
};
