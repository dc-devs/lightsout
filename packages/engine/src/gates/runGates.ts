import { defaultGateTimeoutMinutes } from '#src/common/constants/defaultGateTimeoutMinutes.ts';
import type { GateResult, LightsoutConfig } from '#src/contracts/index.ts';
import { GateScheduleKind } from '#src/gates/common/constants/GateScheduleKind.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import type { GateSchedule } from '#src/gates/common/types/GateSchedule.ts';
import { stageCountOf } from '#src/gates/common/utils/stageCountOf.ts';
import { createGateRunner } from '#src/gates/createGateRunner.ts';
import { withGateLock } from '#src/gates/gateLock/index.ts';
import { runGateSchedule } from '#src/gates/runGateSchedule.ts';

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
	/** Wait for the machine when another gate run holds it. Default true; false takes one attempt and answers a coordination reason rather than waiting. */
	waitForMachine?: boolean;
	/** Structured sink — one entry per command execution or scoped skip. Feeds verify's evidence list; independent of the commands.jsonl log. */
	onGateResult?: (result: GateResult) => void;
	/** Live progress sink — one line per command result. Silent when omitted. */
	onProgress?: (message: string) => void;
}

/**
 * Run the consumer's verification gates, holding the machine for the whole of
 * it. Non-monorepo (no `package-gates`): the whole-repo `gates.*` run as one
 * group — exit codes are the only evidence accepted. Monorepo: `package-gates`
 * templates run once per package in scope, in parallel, unless whole-repository
 * precedence is requested because files outside the packages dir changed. In
 * that case, only the root group runs. Package errors aggregate across groups,
 * labelled per package. Every command execution is logged to the run's
 * commands.jsonl.
 *
 * Every worktree of one repository shares one gate reservation, because they
 * share one machine: four of them starting `pnpm test` in the same second is
 * what makes a suite that passes alone time out or die under load. The
 * reservation is taken around the WHOLE scheduled run — the codegen command,
 * every stage, every package group and every crash re-run — because the settled
 * decision is the whole run, and because codegen mutates the tree and must be
 * inside it. A schedule that runs no stage at all takes none and waits for
 * nothing: there is nothing to serialise, and a repository whose checkpoint is
 * off must behave exactly as it does today.
 *
 * A run that cannot have the machine answers `coordination` alongside `error`,
 * with no failed family and no crash. That red is not evidence about the code —
 * no gate command executed — so no fix agent may be spent on it, while a caller
 * that reads only `error` still fails closed.
 *
 * A gate whose red is nothing but the known jest worker crash is re-run before
 * its exit code is believed, and if it never recovers it is reported through
 * `crashes` as well as `error` — red, but never as a family a fix agent is
 * asked to repair.
 *
 * Two invariants this function keeps, neither of which the type system can.
 * First, no other lock is acquired while the reservation is held and the
 * reservation never outlives the call, so the ordering is always repository run
 * lock outer, gate reservation inner — the queue coordinator holds that run
 * lock for a whole drain while its shipping validation calls in here. Second,
 * one engine process runs one gate run at a time: a second concurrent call
 * inside one process would wait the full ceiling for a reservation its own
 * process is holding. That holds today because a run's verification checkpoints
 * are sequential and the queue's ship lane is guarded to one merge in flight,
 * and this is where a change that broke it would have to answer for itself.
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

	return 'coordination' in outcome ? { error: outcome.coordination, failedFamilies: [], crashes: [], coordination: outcome.coordination } : outcome.held;
};
