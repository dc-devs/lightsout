import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { LoadedJestConfig } from '#src/coverage/common/types/LoadedJestConfig.ts';
import type { CoverageCollection } from '#src/coverage/selectCollectedFiles/common/types/CoverageCollection.ts';

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

interface Params {
	/** The scope's loaded Jest configuration, or undefined when the engine could not read one. */
	loaded: LoadedJestConfig | undefined;
}

/**
 * A scope's coverage collection settings from an already-loaded Jest
 * configuration, or undefined when there was none to load or its shape is
 * unrecognisable.
 *
 * Undefined is the honest answer and the safe one: every caller reads it as
 * "assume the file is collected", which is exactly the behaviour that shipped
 * before this reader existed.
 */
export const readCoverageCollection = ({ loaded }: Params): CoverageCollection | undefined => {
	if (loaded === undefined) {
		return undefined;
	}

	const parsed = JestConfigShape.safeParse(loaded.config);

	if (!parsed.success) {
		return undefined;
	}

	// Jest resolves rootDir against the directory holding the config, and
	// defaults it to that directory.
	const configDir = dirname(loaded.configPath);

	return {
		rootDir: parsed.data.rootDir === undefined ? configDir : resolve(configDir, parsed.data.rootDir),
		collectCoverageFrom: parsed.data.collectCoverageFrom,
		coveragePathIgnorePatterns: parsed.data.coveragePathIgnorePatterns ?? defaultIgnorePatterns,
	};
};
