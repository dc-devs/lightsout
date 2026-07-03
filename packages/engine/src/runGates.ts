import type { LightsoutConfig } from '@lightsout/contracts';
import { appendCommandLog } from './appendCommandLog';
import { resolvePackageName } from './resolvePackageName';
import { runCommand } from './runCommand';

const gateTimeoutMs = 10 * 60_000;
const defaultPackagesDir = 'packages';
const outputTailChars = 2000;

interface GateCommands {
	check: string;
	testUnit: string;
	testCoverage?: string;
	build?: string;
}

type RunGate = (params: { kind: string; command: string; group: string }) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

/** Run one group's gates in order: check → tests → coverage → build. First failure wins. */
const runGateSet = async ({ commands, label, gate }: { commands: GateCommands; label?: string; gate: RunGate }) => {
	const group = label ?? 'root';
	const prefix = label ? `[${label}] ` : '';
	const check = await gate({ kind: 'check', command: commands.check, group });

	if (check.exitCode !== 0) {
		return `${prefix}check failed (exit ${check.exitCode}):\n${check.stdout}\n${check.stderr}`;
	}

	const tests = await gate({ kind: 'testUnit', command: commands.testUnit, group });

	if (tests.exitCode !== 0) {
		return `${prefix}test-unit failed (exit ${tests.exitCode}):\n${tests.stdout}\n${tests.stderr}`;
	}

	if (commands.testCoverage) {
		const coverageResult = await gate({ kind: 'testCoverage', command: commands.testCoverage, group });

		if (coverageResult.exitCode !== 0) {
			return `${prefix}test-coverage failed (exit ${coverageResult.exitCode}):\n${coverageResult.stdout}\n${coverageResult.stderr}`;
		}
	}

	if (commands.build) {
		const build = await gate({ kind: 'build', command: commands.build, group });

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
	/** When set, every command execution is appended to the run's commands.jsonl. */
	runId?: string;
	/** Pipeline step in flight, recorded in the command log. */
	step?: string;
	/** Live progress sink — one line per command result. Silent when omitted. */
	onProgress?: (message: string) => void;
}

/**
 * Run the consumer's verification gates. Non-monorepo (no `packageScripts`):
 * the whole-repo `scripts.*` run as one group — exit codes are the only
 * evidence accepted. Monorepo: `packageScripts` templates run once per
 * package in scope, in parallel, with `{package}` replaced by each package's
 * package.json name; the root group runs only when requested (files outside
 * the packages dir changed). Errors aggregate across groups, labelled per
 * package. Every command execution is logged to the run's commands.jsonl.
 */
export const runGates = async ({ cwd, config, coverage, packages, includeRoot, runId, step, onProgress }: Params) => {
	const executeOnce = async ({ kind, command, group, rerun }: { kind: string; command: string; group: string; rerun?: boolean }) => {
		const startedAt = Date.now();
		let result;

		try {
			result = await runCommand({ command, cwd, timeoutMs: gateTimeoutMs });
		} catch (error) {
			// A gate that times out or fails to spawn is a red gate, not a crash.
			result = { exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
		}

		onProgress?.(`gate [${group}] ${kind}${rerun ? ' (re-run)' : ''}: exit ${result.exitCode} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);

		if (runId) {
			await appendCommandLog({
				cwd,
				runId,
				record: {
					at: new Date().toISOString(),
					step,
					group,
					kind,
					command,
					exitCode: result.exitCode,
					durationMs: Date.now() - startedAt,
					...(rerun ? { rerun: true } : {}),
					...(result.exitCode === 0 ? {} : { outputTail: `${result.stdout}\n${result.stderr}`.slice(-outputTailChars) }),
				},
			});
		}

		return result;
	};

	const gate: RunGate = async ({ kind, command, group }) => {
		const first = await executeOnce({ kind, command, group });

		// One mechanical re-run before a red verdict — a single flaky worker
		// crash in a big suite (observed: jest SIGSEGV zeroing coverage) must
		// not fail a long run at the finish line. Two consecutive reds are a
		// genuine red. Synthetic -1 results (spawn failure, timeout) don't
		// re-run: repeating a 10-minute timeout only doubles the cost of
		// learning the ceiling is too low, and both executions are in the log.
		if (first.exitCode === 0 || first.exitCode === -1) {
			return first;
		}

		onProgress?.(`gate [${group}] ${kind}: red (exit ${first.exitCode}) — re-running once to rule out flake`);

		return executeOnce({ kind, command, group, rerun: true });
	};

	// Codegen runs once, before any group fans out — gates verify, generate
	// mutates, and parallel per-package gates must never race a generator.
	if (config.scripts.generate) {
		const generated = await gate({ kind: 'generate', command: config.scripts.generate, group: 'root' });

		if (generated.exitCode !== 0) {
			return `generate failed (exit ${generated.exitCode}):\n${generated.stdout}\n${generated.stderr}`;
		}
	}

	const rootCommands: GateCommands = {
		check: config.scripts.check,
		testUnit: config.scripts.testUnit,
		testCoverage: coverage && typeof config.scripts.testCoverage === 'string' ? config.scripts.testCoverage : undefined,
		build: config.scripts.build,
	};
	const scoped = config.packageScripts;

	if (!scoped || !packages || packages.length === 0) {
		return runGateSet({ commands: rootCommands, gate });
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
			label: packageDir,
			gate,
			commands: {
				check: substitute(scoped.check),
				testUnit: substitute(scoped.testUnit),
				testCoverage: coverage && scoped.testCoverage ? substitute(scoped.testCoverage) : undefined,
				build: scoped.build ? substitute(scoped.build) : undefined,
			},
		});
	};

	// Scoped groups run in parallel — they are disjoint per package. The root
	// group waits for them: whole-repo commands are heavy by nature and
	// overlap the scoped suites by construction, and running them
	// concurrently put multiple full test fleets on one machine (observed:
	// jest worker SIGSEGV under the contention).
	const results = await Promise.all(packages.map(packageGate));

	if (includeRoot) {
		results.push(await runGateSet({ commands: rootCommands, gate, label: 'root' }));
	}

	const errors = results.filter((result): result is string => Boolean(result));

	return errors.length > 0 ? errors.join('\n\n') : undefined;
};
