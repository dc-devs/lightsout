import type { LightsoutConfig } from '@lightsout/contracts';
import { resolvePackageName } from './resolvePackageName';
import { runCommand } from './runCommand';

const gateTimeoutMs = 10 * 60_000;
const defaultPackagesDir = 'packages';

interface GateCommands {
	check: string;
	testUnit: string;
	testCoverage?: string;
	build?: string;
}

/** Run one group's gates in order: check → tests → coverage → build. First failure wins. */
const runGateSet = async ({ cwd, commands, label }: { cwd: string; commands: GateCommands; label?: string }) => {
	const prefix = label ? `[${label}] ` : '';
	const check = await runCommand({ command: commands.check, cwd, timeoutMs: gateTimeoutMs });

	if (check.exitCode !== 0) {
		return `${prefix}check failed (exit ${check.exitCode}):\n${check.stdout}\n${check.stderr}`;
	}

	const tests = await runCommand({ command: commands.testUnit, cwd, timeoutMs: gateTimeoutMs });

	if (tests.exitCode !== 0) {
		return `${prefix}test-unit failed (exit ${tests.exitCode}):\n${tests.stdout}\n${tests.stderr}`;
	}

	if (commands.testCoverage) {
		const coverageResult = await runCommand({ command: commands.testCoverage, cwd, timeoutMs: gateTimeoutMs });

		if (coverageResult.exitCode !== 0) {
			return `${prefix}test-coverage failed (exit ${coverageResult.exitCode}):\n${coverageResult.stdout}\n${coverageResult.stderr}`;
		}
	}

	if (commands.build) {
		const build = await runCommand({ command: commands.build, cwd, timeoutMs: gateTimeoutMs });

		if (build.exitCode !== 0) {
			return `${prefix}build failed (exit ${build.exitCode}):\n${build.stdout}\n${build.stderr}`;
		}
	}

	return undefined;
};

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/**
	 * Also run the coverage gate. On at clean-slate and every verify AFTER
	 * tests exist; off for verify-implement, where freshly written source has
	 * no tests yet and a coverage failure would not be the agent's fault.
	 */
	coverage?: boolean;
	/**
	 * Package scope for scoped gates (directory names under packagesDir).
	 * Ignored unless `config.packageScripts` is set.
	 */
	packages?: string[];
	/** In scoped mode, also run the root group (whole-repo `scripts.*`). */
	includeRoot?: boolean;
}

/**
 * Run the consumer's verification gates. Non-monorepo (no `packageScripts`):
 * the whole-repo `scripts.*` run as one group — exit codes are the only
 * evidence accepted. Monorepo: `packageScripts` templates run once per
 * package in scope, in parallel, with `{package}` replaced by each package's
 * package.json name; the root group runs only when requested (files outside
 * the packages dir changed). Errors aggregate across groups, labelled per
 * package.
 */
export const runGates = async ({ cwd, config, coverage, packages, includeRoot }: Params) => {
	const rootCommands: GateCommands = {
		check: config.scripts.check,
		testUnit: config.scripts.testUnit,
		testCoverage: coverage && typeof config.scripts.testCoverage === 'string' ? config.scripts.testCoverage : undefined,
		build: config.scripts.build,
	};
	const scoped = config.packageScripts;

	if (!scoped || !packages || packages.length === 0) {
		return runGateSet({ cwd, commands: rootCommands });
	}

	const packagesDir = config.packagesDir ?? defaultPackagesDir;
	const packageGate = async (packageDir: string) => {
		let name: string;

		try {
			name = await resolvePackageName({ cwd, packagesDir, packageDir });
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}

		const substitute = (command: string) => command.split('{package}').join(name);

		return runGateSet({
			cwd,
			label: packageDir,
			commands: {
				check: substitute(scoped.check),
				testUnit: substitute(scoped.testUnit),
				testCoverage: coverage && scoped.testCoverage ? substitute(scoped.testCoverage) : undefined,
				build: scoped.build ? substitute(scoped.build) : undefined,
			},
		});
	};

	const results = await Promise.all([
		...packages.map(packageGate),
		...(includeRoot ? [runGateSet({ cwd, commands: rootCommands, label: 'root' })] : []),
	]);
	const errors = results.filter((result): result is string => Boolean(result));

	return errors.length > 0 ? errors.join('\n\n') : undefined;
};
