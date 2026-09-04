import { resolveGates } from '#src/common/config/resolveGates.ts';
import { defaultGateTimeoutMinutes } from '#src/common/constants/defaultGateTimeoutMinutes.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import type { GateResult, LightsoutConfig } from '#src/contracts/index.ts';
import { GateScheduleKind } from '#src/gates/common/constants/GateScheduleKind.ts';
import type { GateCommands } from '#src/gates/common/types/GateCommands.ts';
import type { GateEntry } from '#src/gates/common/types/GateEntry.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import type { GateSchedule } from '#src/gates/common/types/GateSchedule.ts';
import type { RunGate } from '#src/gates/common/types/RunGate.ts';
import { buildGateEntries } from '#src/gates/common/utils/buildGateEntries.ts';
import { buildGateStages } from '#src/gates/common/utils/buildGateStages.ts';
import { describeGateCrash } from '#src/gates/common/utils/describeGateCrash.ts';
import { mergeGateRunResults } from '#src/gates/common/utils/mergeGateRunResults.ts';
import { createGateRunner } from '#src/gates/createGateRunner.ts';
import { runGateSet } from '#src/gates/runGateSet.ts';
import { runPackageGates } from '#src/gates/runPackageGates.ts';

/** How many stages each schedule runs — the tier boundary is the one place a run has more than one. */
const stageCounts: Record<GateScheduleKind, number> = {
	[GateScheduleKind.Single]: 1,
	[GateScheduleKind.Tiered]: 2,
	[GateScheduleKind.Exact]: 1,
	[GateScheduleKind.Off]: 0,
};

/** The root group's commands, the coverage one included whenever the config configures it — `buildGateStages` is what decides whether it is scheduled. */
const rootCommands = ({ gates }: { gates: ReturnType<typeof resolveGates> }): GateCommands => ({
	check: gates.check,
	test: gates.test,
	testCoverage: typeof gates.testCoverage === 'string' ? gates.testCoverage : undefined,
	extraTests: gates.extraTests,
	build: gates.build,
});

/**
 * The codegen command's red as a result, or nothing when it passed or was never
 * configured.
 *
 * It runs once, before any group fans out — gates verify, generate mutates, and
 * parallel per-package gates must never race a generator. That makes it a
 * precondition of running gates rather than a gate of its own, so an override's
 * list gets it too, and a checkpoint that is off gets nothing.
 */
const runGenerate = async ({ gate, command }: { gate: RunGate; command: string | undefined }) => {
	if (command === undefined) {
		return undefined;
	}

	const generated = await gate({ kind: 'generate', command, group: 'root' });

	if (generated.exitCode === 0) {
		return undefined;
	}

	return {
		error: `generate failed (exit ${generated.exitCode}):\n${generated.stdout}\n${generated.stderr}`,
		failedFamilies: generated.crashed ? [] : ['generate'],
		crashes: generated.crashed ? [describeGateCrash({ label: 'generate' })] : [],
	};
};

/** One line saying why a suite stopped appearing in the log — a held tier reads as a broken runner without it. */
const heldTierMessage = ({ failedFamilies }: { failedFamilies: string[] }) =>
	`gate: expensive gates not started — a cheap gate is red (${failedFamilies.length > 0 ? failedFamilies.join(', ') : 'crash'})`;

/** What an override earns when nothing it named could run: the engine saying the checkpoint had no gates, never a family a fix agent is handed. */
const overrideMatchedNothing = ({ gates }: { gates: string[] }): GateRunResult => ({
	error: `gate-overrides named no gate this run could execute: ${gates.join(', ')} — every named gate is absent from the group(s) that ran at this checkpoint`,
	failedFamilies: [],
	crashes: [],
});

/**
 * One stage across every group in scope, run in parallel and folded into one
 * result — the root group alone, or one call per package.
 *
 * The groups of a stage are disjoint, and the stage boundary is where they all
 * wait: nothing here starts until the stage before it came back green in every
 * group. `context` is absent in a repo with no scoped block, which is also the
 * only shape in which the root group can be the thing that runs.
 */
const runGateStage = async ({
	stage,
	rootStages,
	packages,
	gate,
	failFast,
	context,
}: {
	stage: number;
	rootStages: GateEntry[][];
	packages: string[];
	gate: RunGate;
	failFast?: boolean;
	context: Omit<Parameters<typeof runPackageGates>[0], 'packageDir' | 'stage' | 'gate' | 'failFast'> | undefined;
}) => {
	if (context === undefined || packages.length === 0) {
		return runGateSet({ entries: rootStages[stage] ?? [], gate, failFast });
	}

	const results = await Promise.all(packages.map((packageDir) => runPackageGates({ ...context, packageDir, stage, gate, failFast })));

	return mergeGateRunResults({ results });
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
	 *
	 * It governs a stage of a `single` or `tiered` schedule. An `exact` schedule
	 * always stops at its first red whatever is passed here, because the declared
	 * order is the whole reason to write one.
	 */
	failFast?: boolean;
	/**
	 * How this run's gates are scheduled. Absent = `single`: one stage in the
	 * engine's canonical order, which is exactly what this function has always
	 * done. Only the verification checkpoints pass a schedule; every other gate
	 * caller keeps today's behaviour by asking for none.
	 */
	schedule?: GateSchedule;
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
 *
 * Stages are how a schedule holds work back. A `tiered` run has two — the cheap
 * gates, then the expensive ones — and every group in scope finishes the first
 * before any group starts the second, so one package's red lint never costs
 * another package its end-to-end suite. A stage that came back red, a crash
 * included, ends the run: the checkpoint has its verdict, or produced none at
 * all, and either way the expensive tier would buy nothing.
 *
 * A gate whose red is nothing but the known jest worker crash is re-run before
 * its exit code is believed, and if it never recovers it is reported through
 * `crashes` as well as `error` — red, but never as a family a fix agent is
 * asked to repair.
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
	schedule,
	onGateResult,
	onProgress,
}: Params): Promise<GateRunResult> => {
	const runner = createGateRunner({
		cwd,
		timeoutMs: (config.timeouts?.['gate-minutes'] ?? defaultGateTimeoutMinutes) * 60_000,
		runId,
		step,
		onGateResult,
		onProgress,
	});
	// Counted, because an override that executed nothing must not report green:
	// a checkpoint claiming a verdict it never earned is worse than a red one.
	let executed = 0;
	const gate: RunGate = async (params) => {
		executed += 1;

		return runner(params);
	};
	const gates = resolveGates({ gates: config.gates });
	const resolvedSchedule: GateSchedule = schedule ?? { kind: GateScheduleKind.Single };
	const stageCount = stageCounts[resolvedSchedule.kind];
	const generateFailure = stageCount === 0 ? undefined : await runGenerate({ gate, command: gates.generate });
	const executedBeforeStages = executed;
	const scoped = config['package-gates'];
	const inScope = packages ?? [];
	const scopedPackages = scoped === undefined || includeRoot ? [] : inScope;
	const rootStages = buildGateStages({ entries: buildGateEntries({ commands: rootCommands({ gates }) }), schedule: resolvedSchedule, coverage });
	const packagesDir = config['packages-dir'] ?? defaultPackagesDir;
	const context = scoped === undefined ? undefined : { cwd, packagesDir, scoped, coverage, schedule: resolvedSchedule, runId, step, onGateResult, onProgress };
	const stageFailFast = resolvedSchedule.kind === GateScheduleKind.Exact ? true : failFast;
	const stageResults: GateRunResult[] = [];

	for (let stage = 0; generateFailure === undefined && stage < stageCount; stage += 1) {
		const stageResult = await runGateStage({ stage, rootStages, packages: scopedPackages, gate, failFast: stageFailFast, context });

		stageResults.push(stageResult);

		if (stageResult.error !== undefined) {
			if (stage + 1 < stageCount) {
				onProgress?.(heldTierMessage({ failedFamilies: stageResult.failedFamilies }));
			}

			break;
		}
	}

	let result = generateFailure ?? mergeGateRunResults({ results: stageResults });
	const named = resolvedSchedule.kind === GateScheduleKind.Exact ? resolvedSchedule.gates : [];

	// A partial match takes no branch: the gates that ran are evidence, and a
	// package that skipped one already narrated that skip.
	if (named.length > 0 && executed === executedBeforeStages && result.error === undefined) {
		result = overrideMatchedNothing({ gates: named });
	}

	return result;
};
