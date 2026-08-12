import { defaultPackagesDir } from '@/common/constants/defaultPackagesDir';
import type { GateResult, LightsoutConfig } from '@/contracts';
import type { GateCommands } from '@/pipeline/common/types/GateCommands';
import { createGateRunner } from '@/pipeline/createGateRunner';
import { runGateSet } from '@/pipeline/runGateSet';
import { runPackageGates } from '@/pipeline/runPackageGates';

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
	 * Ignored unless `config.packageGates` is set.
	 */
	packages?: string[];
	/** In scoped mode, also run the root group (whole-repo `gates.*`). */
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
 * Run the consumer's verification gates. Non-monorepo (no `packageGates`):
 * the whole-repo `gates.*` run as one group — exit codes are the only
 * evidence accepted. Monorepo: `packageGates` templates run once per
 * package in scope, in parallel, and the root group runs only when requested
 * (files outside the packages dir changed). Errors aggregate across groups,
 * labelled per package. Every command execution is logged to the run's
 * commands.jsonl.
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
}: Params): Promise<string | undefined> => {
	const gate = createGateRunner({ cwd, runId, step, onGateResult, onProgress });

	// Codegen runs once, before any group fans out — gates verify, generate
	// mutates, and parallel per-package gates must never race a generator.
	if (config.gates.generate) {
		const generated = await gate({ kind: 'generate', command: config.gates.generate, group: 'root' });

		if (generated.exitCode !== 0) {
			return `generate failed (exit ${generated.exitCode}):\n${generated.stdout}\n${generated.stderr}`;
		}
	}

	const rootCommands: GateCommands = {
		check: config.gates.check,
		test: config.gates.test,
		testCoverage: coverage && typeof config.gates.testCoverage === 'string' ? config.gates.testCoverage : undefined,
		build: config.gates.build,
	};
	const scoped = config.packageGates;

	if (!scoped || !packages || packages.length === 0) {
		return runGateSet({ commands: rootCommands, gate, failFast });
	}

	const packagesDir = config.packagesDir ?? defaultPackagesDir;

	// Scoped groups run in parallel — they are disjoint per package. The root
	// group waits for them: whole-repo commands are heavy by nature and
	// overlap the scoped suites by construction, and running them
	// concurrently put multiple full test fleets on one machine (observed:
	// jest worker SIGSEGV under the contention).
	const results = await Promise.all(
		packages.map((packageDir) => runPackageGates({ cwd, packagesDir, packageDir, scoped, coverage, gate, failFast, runId, step, onGateResult, onProgress })),
	);

	if (includeRoot) {
		results.push(await runGateSet({ commands: rootCommands, gate, label: 'root', failFast }));
	}

	const errors = results.filter((result): result is string => Boolean(result));

	return errors.length > 0 ? errors.join('\n\n') : undefined;
};
