import { resolveGates } from '#src/common/config/resolveGates.ts';
import { defaultGateTimeoutMinutes } from '#src/common/constants/defaultGateTimeoutMinutes.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import type { GateResult, LightsoutConfig } from '#src/contracts/index.ts';
import type { GateCommands } from '#src/gates/common/types/GateCommands.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import { createGateRunner } from '#src/gates/createGateRunner.ts';
import { runGateSet } from '#src/gates/runGateSet.ts';
import { runPackageGates } from '#src/gates/runPackageGates.ts';

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
	 * Ignored unless `config['package-gates']` is set.
	 */
	packages?: string[];
	/** In scoped mode, run the whole-repository `gates.*` instead of package groups. */
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
 * Run the consumer's verification gates. Non-monorepo (no `package-gates`):
 * the whole-repo `gates.*` run as one group — exit codes are the only
 * evidence accepted. Monorepo: `package-gates` templates run once per
 * package in scope, in parallel, unless whole-repository precedence is
 * requested because files outside the packages dir changed. In that case,
 * only the root group runs. Package errors aggregate across groups, labelled
 * per package. Every command execution is logged to the run's commands.jsonl.
 */
export const runGates = async ({
	cwd,
	config,
	coverage,
	packages,
	includeRoot,
	runId,
	step,
	failFast,
	onGateResult,
	onProgress,
}: Params): Promise<GateRunResult> => {
	const gate = createGateRunner({
		cwd,
		timeoutMs: (config.timeouts?.['gate-minutes'] ?? defaultGateTimeoutMinutes) * 60_000,
		runId,
		step,
		onGateResult,
		onProgress,
	});

	// Codegen runs once, before any group fans out — gates verify, generate
	// mutates, and parallel per-package gates must never race a generator.
	const gates = resolveGates({ gates: config.gates });
	let result: GateRunResult | undefined;

	if (gates.generate) {
		const generated = await gate({ kind: 'generate', command: gates.generate, group: 'root' });

		if (generated.exitCode !== 0) {
			result = { error: `generate failed (exit ${generated.exitCode}):\n${generated.stdout}\n${generated.stderr}`, failedFamilies: ['generate'] };
		}
	}

	if (!result) {
		const rootCommands: GateCommands = {
			check: gates.check,
			test: gates.test,
			testCoverage: coverage && typeof gates.testCoverage === 'string' ? gates.testCoverage : undefined,
			extraTests: gates.extraTests,
			build: gates.build,
		};
		const scoped = config['package-gates'];

		if (!scoped || !packages || packages.length === 0 || includeRoot) {
			result = await runGateSet({ commands: rootCommands, gate, failFast });
		} else {
			const packagesDir = config['packages-dir'] ?? defaultPackagesDir;

			// Scoped groups run in parallel — they are disjoint per package.
			const results = await Promise.all(
				packages.map((packageDir) =>
					runPackageGates({ cwd, packagesDir, packageDir, scoped, coverage, gate, failFast, runId, step, onGateResult, onProgress }),
				),
			);

			const errors = results.flatMap((gateResult) => (gateResult.error ? [gateResult.error] : []));

			result = {
				error: errors.length > 0 ? errors.join('\n\n') : undefined,
				failedFamilies: [...new Set(results.flatMap((gateResult) => gateResult.failedFamilies))],
			};
		}
	}

	return result;
};
