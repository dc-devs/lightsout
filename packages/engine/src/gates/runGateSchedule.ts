import { resolveGates } from '#src/common/config/resolveGates.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import type { GateResult, LightsoutConfig } from '#src/contracts/index.ts';
import { GateScheduleKind } from '#src/gates/common/constants/GateScheduleKind.ts';
import type { GateEntry } from '#src/gates/common/types/GateEntry.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import type { GateSchedule } from '#src/gates/common/types/GateSchedule.ts';
import type { RunGate } from '#src/gates/common/types/RunGate.ts';
import { buildGateEntries } from '#src/gates/common/utils/buildGateEntries.ts';
import { buildGateStages } from '#src/gates/common/utils/buildGateStages.ts';
import { describeGateCrash } from '#src/gates/common/utils/describeGateCrash.ts';
import { mergeGateRunResults } from '#src/gates/common/utils/mergeGateRunResults.ts';
import { rootGateCommands } from '#src/gates/common/utils/rootGateCommands.ts';
import { stageCountOf } from '#src/gates/common/utils/stageCountOf.ts';
import { runGateSet } from '#src/gates/runGateSet.ts';
import { runPackageGates } from '#src/gates/runPackageGates.ts';

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
		coordination: undefined,
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
	coordination: undefined,
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
	coverage?: boolean;
	packages?: string[];
	includeRoot?: boolean;
	runId?: string;
	step?: string;
	failFast?: boolean;
	/** Already resolved by `runGates` — the one place the default is chosen. */
	schedule: GateSchedule;
	/** The gate-execution policy `runGates` built, already wired to the reservation's spawn and exit hooks. */
	gate: RunGate;
	onGateResult?: (result: GateResult) => void;
	onProgress?: (message: string) => void;
}

/**
 * The scheduled gate run itself: the codegen command, then every stage, each
 * stage fanning out over the root group or the package groups.
 *
 * Stages are how a schedule holds work back. A `tiered` run has two — the cheap
 * gates, then the expensive ones — and every group in scope finishes the first
 * before any group starts the second, so one package's red lint never costs
 * another package its end-to-end suite. A stage that came back red, a crash
 * included, ends the run: the checkpoint has its verdict, or produced none at
 * all, and either way the expensive tier would buy nothing.
 *
 * Split out of `runGates` so the shared gate reservation's lifecycle has
 * somewhere to sit: what a run schedules is a separate decision from whether
 * this machine may run it at all. A module internal, not published by the gates
 * barrel; its behaviour stays pinned by `runGates`' own suites.
 */
export const runGateSchedule = async ({
	cwd,
	config,
	coverage,
	packages,
	includeRoot,
	runId,
	step,
	failFast,
	schedule,
	gate,
	onGateResult,
	onProgress,
}: Params): Promise<GateRunResult> => {
	// Counted, because an override that executed nothing must not report green:
	// a checkpoint claiming a verdict it never earned is worse than a red one.
	let executed = 0;
	const countedGate: RunGate = async (params) => {
		executed += 1;

		return gate(params);
	};
	const gates = resolveGates({ gates: config.gates });
	const stageCount = stageCountOf({ schedule });
	const generateFailure = stageCount === 0 ? undefined : await runGenerate({ gate: countedGate, command: gates.generate });
	const executedBeforeStages = executed;
	const scoped = config['package-gates'];
	const inScope = packages ?? [];
	const scopedPackages = scoped === undefined || includeRoot ? [] : inScope;
	const rootStages = buildGateStages({ entries: buildGateEntries({ commands: rootGateCommands({ gates }) }), schedule, coverage });
	const packagesDir = config['packages-dir'] ?? defaultPackagesDir;
	const context = scoped === undefined ? undefined : { cwd, packagesDir, scoped, coverage, schedule, runId, step, onGateResult, onProgress };
	const stageFailFast = schedule.kind === GateScheduleKind.Exact ? true : failFast;
	const stageResults: GateRunResult[] = [];

	for (let stage = 0; generateFailure === undefined && stage < stageCount; stage += 1) {
		const stageResult = await runGateStage({ stage, rootStages, packages: scopedPackages, gate: countedGate, failFast: stageFailFast, context });

		stageResults.push(stageResult);

		if (stageResult.error !== undefined) {
			if (stage + 1 < stageCount) {
				onProgress?.(heldTierMessage({ failedFamilies: stageResult.failedFamilies }));
			}

			break;
		}
	}

	let result = generateFailure ?? mergeGateRunResults({ results: stageResults });
	const named = schedule.kind === GateScheduleKind.Exact ? schedule.gates : [];

	// A partial match takes no branch: the gates that ran are evidence, and a
	// package that skipped one already narrated that skip.
	if (named.length > 0 && executed === executedBeforeStages && result.error === undefined) {
		result = overrideMatchedNothing({ gates: named });
	}

	return result;
};
