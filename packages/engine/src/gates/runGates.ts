import { defaultGateTimeoutMinutes } from '#src/common/constants/defaultGateTimeoutMinutes.ts';
import type { GateResult } from '#src/contracts/gates/GateResult.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { GateScheduleKind } from '#src/gates/common/constants/GateScheduleKind.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import type { GateSchedule } from '#src/gates/common/types/GateSchedule.ts';
import { withGateLock } from '#src/gates/gateLock/withGateLock.ts';
import { stageCountOf } from '#src/gates/internal/common/utils/stageCountOf.ts';
import { createGateRunner } from '#src/gates/internal/createGateRunner.ts';
import { runGateSchedule } from '#src/gates/internal/runGateSchedule.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Also run the coverage gate. Off for verify-implement, where new source has no tests yet. */
	coverage?: boolean;
	/** Packages in scope (directory names under packagesDir); only used with `package-gates`. */
	packages?: string[];
	/** In scoped mode, run the whole-repository `gates.*` instead of package groups. */
	includeRoot?: boolean;
	/** When set, every command execution is appended to the run's commands.jsonl. */
	runId?: string;
	/** Pipeline step in flight, recorded in the command log. */
	step?: string;
	/** Stop each group at its first red (default). An `exact` schedule always stops at its first red. */
	failFast?: boolean;
	/** How the gates are scheduled; `single` when absent. */
	schedule?: GateSchedule;
	/** Wait for the machine when another gate run holds it. Default true; false takes one attempt and answers a coordination reason rather than waiting. */
	waitForMachine?: boolean;
	/** Structured sink — one entry per command execution or scoped skip. Feeds verify's evidence list; independent of the commands.jsonl log. */
	onGateResult?: (result: GateResult) => void;
	/** Live progress sink — one line per command result. Silent when omitted. */
	onProgress?: (message: string) => void;
}

/**
 * Runs the repository's gates: the root `gates.*` as one group, or with
 * `package-gates` one group per package in scope. The whole run holds a gate
 * reservation shared by every worktree of the repository, because they share
 * one machine.
 *
 * Crashed and timed-out gates are re-run, and reported in `crashes` and
 * `timeouts`, never as a failed family. A run that could not get the machine
 * reports `coordination`. All three set `error`.
 *
 * Callers must not take another lock while this holds the reservation, and one
 * process must not call this twice at once: the second call would wait on the
 * reservation its own process holds.
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
	waitForMachine,
	onGateResult,
	onProgress,
}: Params): Promise<GateRunResult> => {
	const resolvedSchedule: GateSchedule = schedule ?? { kind: GateScheduleKind.Single };
	const timeoutMs = (config.timeouts?.['gate-minutes'] ?? defaultGateTimeoutMinutes) * 60_000;
	const scheduleParams = { cwd, config, coverage, packages, includeRoot, runId, step, failFast, schedule: resolvedSchedule, onGateResult, onProgress };
	const runnerParams = { cwd, timeoutMs, runId, step, onGateResult, onProgress };

	if (stageCountOf({ schedule: resolvedSchedule }) === 0) {
		return runGateSchedule({ ...scheduleParams, gate: createGateRunner(runnerParams) });
	}

	const outcome = await withGateLock({
		cwd,
		runId,
		waitCeilingMs: waitForMachine === false ? 0 : undefined,
		onProgress,
		run: ({ onGateSpawn, onGateExit }) => runGateSchedule({ ...scheduleParams, gate: createGateRunner({ ...runnerParams, onGateSpawn, onGateExit }) }),
	});

	return 'coordination' in outcome
		? { error: outcome.coordination, failedFamilies: [], crashes: [], timeouts: [], coordination: outcome.coordination }
		: outcome.held;
};
