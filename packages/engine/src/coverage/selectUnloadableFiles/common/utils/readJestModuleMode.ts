import { createRequire } from 'node:module';
import { z } from 'zod';
import type { LoadedJestConfig } from '#src/coverage/common/types/LoadedJestConfig.ts';
import type { JestModuleMode } from '#src/coverage/selectUnloadableFiles/common/types/JestModuleMode.ts';

// Every field degrades to absent rather than failing the read: a shape the
// engine does not recognise is one it must not reason from, and `undefined`
// already means "assume CommonJS, keep exempting" to every caller downstream.
const EsmSettings = z.looseObject({
	extensionsToTreatAsEsm: z.array(z.string()).optional().catch(undefined),
	preset: z.string().optional().catch(undefined),
	projects: z.array(z.unknown()).optional().catch(undefined),
});

const EsmExtensions = z.looseObject({ extensionsToTreatAsEsm: z.array(z.string()).optional().catch(undefined) });

// The canonical way a TypeScript project turns Jest ESM on is
// `preset: 'ts-jest/presets/default-esm'`, which sets extensionsToTreatAsEsm
// inside the preset module rather than in the consumer's own config file.
// Reading literal top-level keys only would report CommonJS for exactly that
// repo. Jest's own resolution order, one level deep: Jest does not chain
// presets, and neither does this.
const readPresetExtensions = ({ configPath, preset }: { configPath: string; preset: string }) => {
	const requirePreset = createRequire(configPath);

	let found: string[] | undefined;

	for (const specifier of [`${preset}/jest-preset`, preset]) {
		if (found === undefined) {
			try {
				const parsed = EsmExtensions.safeParse(requirePreset(specifier));

				found = parsed.success ? parsed.data.extensionsToTreatAsEsm : undefined;
			} catch {
				// a preset that will not resolve contributes nothing
			}
		}
	}

	return found ?? [];
};

// A multi-project config names its settings per project. An entry that is a
// path string is not followed — that is a second config file to locate and
// load, for an answer whose absence is already the safe one.
const readProjectExtensions = ({ projects }: { projects: unknown[] }) => {
	const extensions: string[] = [];

	for (const project of projects) {
		const parsed = EsmExtensions.safeParse(project);

		if (parsed.success) {
			extensions.push(...(parsed.data.extensionsToTreatAsEsm ?? []));
		}
	}

	return extensions;
};

interface Params {
	/** The scope's loaded Jest configuration, or undefined when the engine could not read one. */
	loaded: LoadedJestConfig | undefined;
}

/**
 * How a coverage scope's Jest loads its files, from an already-loaded Jest
 * configuration, or undefined when there was none to load.
 *
 * Undefined is the honest answer and the safe one: every caller reads it as
 * "assume CommonJS", which is exactly the behaviour that shipped before this
 * reader existed. A wrong ESM verdict would fail a run on a file no test could
 * ever cover, so the read only ever reports ESM on positive evidence.
 */
export const readJestModuleMode = ({ loaded }: Params): JestModuleMode | undefined => {
	if (loaded === undefined) {
		return undefined;
	}

	const parsed = EsmSettings.safeParse(loaded.config);

	if (!parsed.success) {
		return undefined;
	}

	const extensions = new Set(['.mjs', ...(parsed.data.extensionsToTreatAsEsm ?? [])]);

	if (parsed.data.preset !== undefined) {
		for (const extension of readPresetExtensions({ configPath: loaded.configPath, preset: parsed.data.preset })) {
			extensions.add(extension);
		}
	}

	for (const extension of readProjectExtensions({ projects: parsed.data.projects ?? [] })) {
		extensions.add(extension);
	}

	// Last on purpose: a configuration that mistakenly lists `.cjs` must not
	// make this reader call a CommonJS file an ES module.
	extensions.delete('.cjs');

	return { esmExtensions: [...extensions] };
};
