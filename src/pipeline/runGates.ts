import type { GateResult, LightsoutConfig } from '@/contracts';
import { appendCommandLog } from '@/runState';
import { extractRunScriptName } from '@/common/utils/extractRunScriptName';
import { resolvePackageManifest } from '@/common/utils/resolvePackageManifest';
import { runCommand } from '@/common/utils/runCommand';
import { runGateSet } from '@/pipeline/runGateSet';
import type { GateCommands } from '@/pipeline/common/types/GateCommands';
import type { RunGate } from '@/pipeline/common/types/RunGate';

const gateTimeoutMs = 10 * 60_000;
const defaultPackagesDir = 'packages';
const outputTailChars = 2000;

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
	/**
	 * Stop each group at its first red (default); false runs every gate in every
	 * group and aggregates the failures — verify's complete-report mode.
	 */
	failFast?: boolean;
	/** Structured sink — one entry per command execution or scoped skip. Feeds verify's evidence list; independent of the commands.jsonl log. */
	onGateResult?: (result: GateResult) => void;
	/** Live progress sink — one line per command result. Silent when omitted. */
	onProgress?: (message: string) => void;
}

/**
 * Run the consumer's verification gates. Non-monorepo (no `packageScripts`):
 * the whole-repo `scripts.*` run as one group — exit codes are the only
 * evidence accepted. Monorepo: `packageScripts` templates run once per
 * package in scope, in parallel, with `{package}` replaced by each package's
 * package.json name; gates whose `run <script>` target a package doesn't
 * define are skipped (narrated + logged); the root group runs only when
 * requested (files outside the packages dir changed). Errors aggregate
 * across groups, labelled per package. Every command execution is logged to
 * the run's commands.jsonl.
 */
export const runGates = async ({ cwd, config, coverage, packages, includeRoot, runId, step, failFast, onGateResult, onProgress }: Params): Promise<string | undefined> => {
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

		// The commands.jsonl record and the structured sink carry the same
		// evidence — build it once. The record adds only the log-specific
		// `at`/`step` on top.
		const gateResult: GateResult = {
			kind,
			group,
			command,
			exitCode: result.exitCode,
			durationMs: Date.now() - startedAt,
			...(rerun ? { rerun: true } : {}),
			...(result.exitCode === 0 ? {} : { outputTail: `${result.stdout}\n${result.stderr}`.slice(-outputTailChars) }),
		};

		if (runId) {
			await appendCommandLog({ cwd, runId, record: { at: new Date().toISOString(), step, ...gateResult } });
		}

		onGateResult?.(gateResult);

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
		return runGateSet({ commands: rootCommands, gate, failFast });
	}

	const packagesDir = config.packagesDir ?? defaultPackagesDir;
	const packageGate = async (packageDir: string) => {
		let manifest: Awaited<ReturnType<typeof resolvePackageManifest>>;

		try {
			manifest = await resolvePackageManifest({ cwd, packagesDir, packageDir });
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}

		const substitute = (command: string) => command.split('{package}').join(manifest.name);

		// A scoped template fans out to every package in scope, including ones
		// the consumer never hand-tuned (infra, docs). A package with no
		// matching script is skipped with evidence, never failed and never
		// silently passed. Detection is convention-based — the script name
		// after the template's `run` token; a template with no `run` token
		// always executes.
		const scopedCommand = async ({ kind, template }: { kind: string; template: string }) => {
			const scriptName = extractRunScriptName({ command: template });

			if (!scriptName || Object.hasOwn(manifest.scripts, scriptName)) {
				return substitute(template);
			}

			onProgress?.(`gate [${packageDir}] ${kind}: skipped (no "${scriptName}" script)`);

			if (runId) {
				await appendCommandLog({
					cwd,
					runId,
					record: {
						at: new Date().toISOString(),
						step,
						group: packageDir,
						kind,
						command: substitute(template),
						skipped: true,
						reason: `no "${scriptName}" script`,
					},
				});
			}

			onGateResult?.({ kind, group: packageDir, command: substitute(template), skipped: true, reason: `no "${scriptName}" script` });

			return undefined;
		};

		const testCoverage = coverage && scoped.testCoverage ? await scopedCommand({ kind: 'testCoverage', template: scoped.testCoverage }) : undefined;

		return runGateSet({
			label: packageDir,
			gate,
			failFast,
			commands: {
				check: await scopedCommand({ kind: 'check', template: scoped.check }),
				// Coverage replaces the plain test run; only when coverage is
				// absent or skipped does testUnit get its own script lookup.
				testUnit: testCoverage ? undefined : await scopedCommand({ kind: 'testUnit', template: scoped.testUnit }),
				testCoverage,
				build: scoped.build ? await scopedCommand({ kind: 'build', template: scoped.build }) : undefined,
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
		results.push(await runGateSet({ commands: rootCommands, gate, label: 'root', failFast }));
	}

	const errors = results.filter((result): result is string => Boolean(result));

	return errors.length > 0 ? errors.join('\n\n') : undefined;
};
