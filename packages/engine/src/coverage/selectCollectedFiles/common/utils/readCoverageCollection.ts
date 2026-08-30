import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { CoverageCollection } from '#src/coverage/selectCollectedFiles/common/types/CoverageCollection.ts';
import { resolveJestConfigPath } from '#src/coverage/selectCollectedFiles/common/utils/resolveJestConfigPath.ts';

/** Jest's own default when the key is absent — naming the key replaces it. */
const defaultIgnorePatterns = ['/node_modules/'];

// Every field degrades to absent rather than failing the read: a shape the
// engine does not recognise is one it must not reason from, and `undefined`
// already means "assume the file is collected" to every caller downstream.
const JestConfigShape = z.looseObject({
	rootDir: z.string().optional().catch(undefined),
	collectCoverageFrom: z.array(z.string()).optional().catch(undefined),
	coveragePathIgnorePatterns: z.array(z.string()).optional().catch(undefined),
});

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

// Jest permits an async config factory, which this reader deliberately does
// not run — a subprocess-free read never executes the consumer's own code.
const isThenable = ({ value }: { value: object }) => 'then' in value && typeof value.then === 'function';

interface Params {
	/** Absolute path to the scope's root directory. */
	scopeRoot: string;
	/** The scope's resolved coverage command, or undefined. */
	coverageScript: string | undefined;
}

/**
 * A scope's coverage collection settings, or undefined when the engine cannot
 * read them — no config found, a config it cannot `require` (TypeScript,
 * ESM-only, a function or promise export), or a runner that is not Jest.
 *
 * Undefined is the honest answer and the safe one: every caller reads it as
 * "assume the file is collected", which is exactly the behaviour that shipped
 * before this reader existed.
 */
export const readCoverageCollection = async ({ scopeRoot, coverageScript }: Params): Promise<CoverageCollection | undefined> => {
	const configPath = await resolveJestConfigPath({ scopeRoot, coverageScript });

	if (configPath === undefined) {
		return undefined;
	}

	const loaded = requireConfig({ configPath });
	const value = configPath.endsWith('package.json') ? readJestKey({ loaded }) : loaded;

	if (typeof value !== 'object' || value === null || isThenable({ value })) {
		return undefined;
	}

	const parsed = JestConfigShape.safeParse(value);

	if (!parsed.success) {
		return undefined;
	}

	// Jest resolves rootDir against the directory holding the config, and
	// defaults it to that directory.
	const configDir = dirname(configPath);

	return {
		rootDir: parsed.data.rootDir === undefined ? configDir : resolve(configDir, parsed.data.rootDir),
		collectCoverageFrom: parsed.data.collectCoverageFrom,
		coveragePathIgnorePatterns: parsed.data.coveragePathIgnorePatterns ?? defaultIgnorePatterns,
	};
};
