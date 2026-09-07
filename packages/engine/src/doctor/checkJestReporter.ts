import { createRequire } from 'node:module';
import { testReporterEnv } from '#src/common/constants/testReporterEnv.ts';
import type { DoctorCheck } from '#src/doctor/common/types/DoctorCheck.ts';
import type { PackageDir } from '#src/doctor/common/types/PackageDir.ts';
import { findJestConfigs } from '#src/doctor/common/utils/findJestConfigs.ts';

/** A path no repository would name by hand, so finding it in `reporters` can only mean the config read the variable. */
const sentinel = '/lightsout/doctor/jest-reporter-probe.cjs';

// A reporters entry is either the module path on its own or a `[path, options]` pair.
const carriesSentinel = ({ reporters }: { reporters: unknown }) =>
	Array.isArray(reporters) && reporters.some((entry: unknown) => entry === sentinel || (Array.isArray(entry) && entry[0] === sentinel));

// A package.json carries the configuration under its `jest` key; every other
// config file exports the configuration object itself.
const configOf = ({ loaded }: { loaded: unknown }) => (typeof loaded === 'object' && loaded !== null && 'jest' in loaded ? loaded.jest : loaded);

// Jest also accepts a config that is a function or a promise. Both load without
// throwing, and neither has a `reporters` key that can be read synchronously —
// so they are unknown, never missing.
const readableConfig = ({ config }: { config: unknown }): Record<string, unknown> | undefined =>
	typeof config === 'object' && config !== null && !('then' in config && typeof config.then === 'function') ? { ...config } : undefined;

/**
 * Whether one config loads the engine's reporter when the engine asks it to, or
 * undefined when the config cannot be read at all.
 *
 * It loads the config rather than searching its text, because a repository whose
 * packages build their config from a shared factory never mentions the variable
 * in the file the walk finds — a text search would warn on exactly the layout
 * this check was written for. The variable is set to a sentinel for the duration
 * of the load and restored afterwards.
 */
const inspectConfig = ({ configPath }: { configPath: string }) => {
	const previous = process.env[testReporterEnv.reporter];

	process.env[testReporterEnv.reporter] = sentinel;

	try {
		// A dynamic require is typed `any`; the annotation is what states that
		// nothing is yet known about the shape.
		const loaded: unknown = createRequire(configPath)(configPath);
		const config = readableConfig({ config: configOf({ loaded }) });

		if (config === undefined) {
			return undefined;
		}

		return { carries: carriesSentinel({ reporters: config.reporters }) };
	} catch {
		return undefined;
	} finally {
		if (previous === undefined) {
			delete process.env[testReporterEnv.reporter];
		} else {
			process.env[testReporterEnv.reporter] = previous;
		}
	}
};

interface Params {
	cwd: string;
	packageDirs: PackageDir[];
}

/**
 * The setup surface for per-test evidence: does each Jest config load the
 * engine's reporter when the engine names one?
 *
 * Without it a run can be green on gates while proving nothing about the tests
 * its plan named. The clean-slate probe is what stops such a run; this is where
 * the gap is visible before a run is ever started. A config the loader cannot
 * read — TypeScript, ESM-only, a function or promise export — is reported as
 * unchecked rather than failed, because nothing is known about it either way.
 *
 * The doctor never applies the fix: adding a reporter changes what every test
 * command in the repository does.
 */
export const checkJestReporter = async ({ cwd, packageDirs }: Params): Promise<DoctorCheck | undefined> => {
	const missing: string[] = [];
	const unchecked: string[] = [];
	let configCount = 0;

	for (const { label, dir } of packageDirs) {
		for (const configPath of await findJestConfigs({ packageDir: dir })) {
			configCount += 1;

			const inspected = inspectConfig({ configPath });
			const where = `${label}: ${configPath.slice(cwd.length + 1)}`;

			if (inspected === undefined) {
				unchecked.push(`${where} (unchecked — could not be read as a configuration object)`);
			} else if (!inspected.carries) {
				missing.push(where);
			}
		}
	}

	if (configCount === 0) {
		return undefined;
	}

	return missing.length === 0
		? { id: 'jest-reporter', status: 'pass', detail: ["every loadable Jest config loads the engine's per-test reporter", ...unchecked].join('; ') }
		: {
				id: 'jest-reporter',
				status: 'warn',
				detail: [...missing, ...unchecked].join('; '),
				fix: `add the engine's reporter to each Jest config — \`const lightsoutReporter = process.env.${testReporterEnv.reporter}; reporters: lightsoutReporter ? ['default', lightsoutReporter] : ['default']\` — naming the \`reporters\` key replaces Jest's default, so 'default' must be restated`,
			};
};
