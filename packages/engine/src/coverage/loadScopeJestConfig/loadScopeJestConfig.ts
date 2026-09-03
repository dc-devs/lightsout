import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { z } from 'zod';
import { extractRunScriptName } from '#src/common/config/extractRunScriptName.ts';
import type { LoadedJestConfig } from '#src/coverage/common/types/LoadedJestConfig.ts';
import { resolveJestConfigPath } from '#src/coverage/loadScopeJestConfig/common/utils/resolveJestConfigPath.ts';

const ScopeManifest = z.looseObject({ scripts: z.record(z.string(), z.string()).optional().catch(undefined) });

// The command a scope's coverage gate ultimately runs. A gate command is
// usually a workspace runner pointed at a script (`pnpm --filter x run
// test:unit:coverage`), and it is that script's body — not the runner
// invocation — that names the Jest config. `readPackageManifest` is not the
// reader for this: it throws on a manifest with no `name`, which is right when
// the engine needs a workspace filter and wrong here, where an unreadable
// manifest simply means "nothing is known".
const resolveScopeCoverageScript = async ({ scopeRoot, command }: { scopeRoot: string; command: string }) => {
	const scriptName = extractRunScriptName({ command });

	if (scriptName === undefined) {
		return command;
	}

	try {
		const parsed = ScopeManifest.safeParse(JSON.parse(await readFile(join(scopeRoot, 'package.json'), 'utf8')));

		return parsed.success ? parsed.data.scripts?.[scriptName] : undefined;
	} catch {
		return undefined;
	}
};

const requireConfig = ({ configPath }: { configPath: string }) => {
	try {
		// A dynamic require is typed `any`; the annotation is what states that
		// nothing is yet known about the shape.
		const loaded: unknown = createRequire(configPath)(configPath);

		return loaded;
	} catch {
		return undefined;
	}
};

// A package.json carries the configuration under its `jest` key; every other
// config file exports the configuration object itself.
const readJestKey = ({ loaded }: { loaded: unknown }) => (typeof loaded === 'object' && loaded !== null && 'jest' in loaded ? loaded.jest : undefined);

// Jest permits an async config factory, which this loader deliberately does
// not run — a subprocess-free read never executes the consumer's own code.
const isThenable = ({ value }: { value: object }) => 'then' in value && typeof value.then === 'function';

interface Params {
	/** Absolute path to the scope's root directory (the repo root, or `<packagesDir>/<scope>`). */
	scopeRoot: string;
	/** The scope's coverage gate command as configured, before any `… run <script>` indirection is resolved. */
	command: string;
}

/**
 * A coverage scope's Jest configuration, loaded but unparsed, or undefined when
 * the engine cannot read one — no config found, a config it cannot `require`
 * (TypeScript, ESM-only, a function or promise export), or a runner that is not
 * Jest.
 *
 * One loader on purpose: every view over a scope's configuration is built from
 * this read, so no two views can disagree about which config file a scope even
 * uses, nor about when the read degrades. Undefined is the honest answer, and
 * each view reads it as the behaviour that shipped before it existed.
 */
export const loadScopeJestConfig = async ({ scopeRoot, command }: Params): Promise<LoadedJestConfig | undefined> => {
	const coverageScript = await resolveScopeCoverageScript({ scopeRoot, command });
	const configPath = await resolveJestConfigPath({ scopeRoot, coverageScript });

	if (configPath === undefined) {
		return undefined;
	}

	const loaded = requireConfig({ configPath });
	const value = configPath.endsWith('package.json') ? readJestKey({ loaded }) : loaded;

	if (typeof value !== 'object' || value === null || isThenable({ value })) {
		return undefined;
	}

	return { configPath, config: value };
};
