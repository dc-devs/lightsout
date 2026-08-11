import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

interface Params {
	/** Where to start walking up. Defaults to the directory of the running engine bundle. */
	startDir?: string;
}

/**
 * A development override: the package to treat as the default, as an absolute or
 * working-directory-relative path.
 *
 * This repo sets it for its own suites, because the walk below can only find the
 * BUILT copy under `plugin/standards/` — the authored package lives beside the
 * engine in `packages/`, which the walk deliberately does not look for. Without
 * the override, every test touching the default would pass or fail on whether
 * someone had run `pnpm bundle`.
 */
const overrideVariable = 'LIGHTSOUT_DEFAULT_STANDARDS';

/**
 * Locate the default standards package the plugin ships — a real folder next to
 * the bundled program, loaded from disk exactly like a third-party package, so
 * "the defaults load through the same path" is literally true.
 *
 * Walks up from the running program, accepting the installed layout
 * (`<plugin>/dist/` beside `<plugin>/standards/`) and this repo's dev layout
 * (`<repo>/plugin/standards/`, the committed copy `pnpm bundle` writes). Both
 * candidates are the SHIPPED shape; the authored package is reached through the
 * override above, never by the walk. Searching a repo's own folders for one would
 * be worse than useless — a consumer that happened to keep its house rules in a
 * folder of the right name would have them silently adopted as the engine's
 * defaults. Synchronous because it runs once per process.
 *
 * The start directory comes from `process.argv[1]` — the engine is always
 * invoked as `node <plugin>/dist/cli.mjs`, so that is the bundle's own path.
 *
 * @param startDir - override the walk's starting directory
 * @throws {Error} When the override names a directory that is not a standards package, or no packaged standards folder exists above the starting directory.
 */
export const resolveDefaultStandardsPackage = ({ startDir }: Params = {}): string => {
	const override = process.env[overrideVariable];

	if (override !== undefined) {
		const overridden = resolve(override);

		// Thrown rather than fallen through to the walk: an override that silently
		// missed would hand back a different package than the one asked for, and
		// the run would look correct while checking the wrong rules.
		if (!existsSync(join(overridden, 'lightsout-standards.json'))) {
			throw new Error(`${overrideVariable} points at ${overridden}, which holds no lightsout-standards.json`);
		}

		return overridden;
	}

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
