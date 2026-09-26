import { mkdir, rm } from 'node:fs/promises';
import { jestCrashCause } from '#src/common/constants/jestCrashCause.ts';
import { testReporterEnv } from '#src/common/constants/testReporterEnv.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import type { CommandResult } from '#src/common/types/CommandResult.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { FrictionArea } from '#src/contracts/friction/FrictionArea.ts';
import type { GateResult } from '#src/contracts/gates/GateResult.ts';
import { GateEnding } from '#src/gates/internal/common/constants/GateEnding.ts';
import type { RunGate } from '#src/gates/internal/common/types/RunGate.ts';
import { buildGateResult } from '#src/gates/internal/common/utils/buildGateResult.ts';
import { classifyGateEnding } from '#src/gates/internal/common/utils/classifyGateEnding.ts';
import { testResultsDir } from '#src/gates/testResults/testResultsDir.ts';
import { writeJestReporter } from '#src/gates/testResults/writeJestReporter.ts';
import { appendCommandLog } from '#src/runState/appendCommandLog.ts';
import { appendFriction } from '#src/runState/appendFriction.ts';

interface Params {
	cwd: string;
	/** Ceiling for one gate command, in milliseconds — `timeouts.gate-minutes`, already resolved by the caller. */
	timeoutMs: number;
	/** When set, every command execution is appended to the run's commands.jsonl. */
	runId?: string;
	/** Pipeline step in flight, recorded in the command log. */
	step?: string;
	/** Structured sink — one entry per command execution. Feeds verify's evidence list; independent of the commands.jsonl log. */
	onGateResult?: (result: GateResult) => void;
	/** Live progress sink — one line per command result. Silent when omitted. */
	onProgress?: (message: string) => void;
	/** The shared gate reservation's record of a gate process group, called once per attempt that spawned. */
	onGateSpawn?: ({ pid }: { pid: number }) => void;
	/** The same reservation forgetting that group once the attempt settles, the timeout path included. */
	onGateExit?: ({ pid }: { pid: number }) => void;
}

/** Executions a gate gets while it keeps crashing; one re-run was not always enough. */
const maxCrashAttempts = 3;

/** Executions a gate gets while it keeps running past its ceiling; each costs a full ceiling. */
const maxTimeoutAttempts = 2;

/**
 * The reporter file and a fresh results directory for one execution, so a re-run
 * is never judged on an earlier attempt's results. Nothing without a run folder.
 */
const prepareEvidence = async ({ cwd, runId, step, kind, group }: { cwd: string; runId?: string; step?: string; kind: string; group: string }) => {
	if (!runId) {
		return undefined;
	}

	const reporterPath = await writeJestReporter({ cwd, runId });
	const dir = await testResultsDir({ cwd, runId, step: step ?? 'gates', group, kind });

	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });

	return { dir, env: { [testReporterEnv.reporter]: reporterPath, [testReporterEnv.resultsDir]: dir } };
};

/** One execution of a gate command. A failed spawn becomes exit -1; `timedOut` says the deadline stopped it. */
const spawnAttempt = async ({
	command,
	cwd,
	timeoutMs,
	env,
	onGateSpawn,
	onGateExit,
}: {
	command: string;
	cwd: string;
	timeoutMs: number;
	env?: Record<string, string>;
	onGateSpawn?: ({ pid }: { pid: number }) => void;
	onGateExit?: ({ pid }: { pid: number }) => void;
}) => {
	let result: CommandResult;
	let timedOut = false;
	// Only an attempt that produced a pid reports an exit to the reservation.
	let spawnedPid: number | undefined;

	try {
		result = await runCommand({
			command,
			cwd,
			timeoutMs,
			env,
			onSpawn: ({ pid }) => {
				spawnedPid = pid;
				onGateSpawn?.({ pid });
			},
			onTimeout: () => {
				timedOut = true;
			},
		});
	} catch (error) {
		result = { exitCode: -1, stdout: '', stderr: messageOf({ error }) };
	}

	if (spawnedPid !== undefined) {
		onGateExit?.({ pid: spawnedPid });
	}

	return { result, timedOut };
};

/** How a crash or a timeout is re-run and reported, each on its own allowance; nothing for other endings. */
const noVerdictPolicy = ({ ending, ceilingMinutes }: { ending: GateEnding; ceilingMinutes: number }) => {
	const policies: Partial<Record<GateEnding, { allowance: number; suffix: string; rerun: string; friction: string }>> = {
		[GateEnding.Crashed]: {
			allowance: maxCrashAttempts,
			suffix: 'jest worker crash',
			rerun: 'jest worker crash, not a test failure',
			friction: `crashed: Jest died without reporting a failing test — not a verdict about the code, re-run up to ${maxCrashAttempts} times. ${jestCrashCause}`,
		},
		[GateEnding.Timeout]: {
			allowance: maxTimeoutAttempts,
			suffix: `timeout at the ${ceilingMinutes}-minute ceiling`,
			rerun: `ran past its ${ceilingMinutes}-minute ceiling, not a verdict about the code`,
			friction: `timed out: it ran past its ${ceilingMinutes}-minute ceiling (timeouts.gate-minutes) without returning an exit code — not a verdict about the code, re-run up to ${maxTimeoutAttempts} times.`,
		},
	};

	return policies[ending];
};

/**
 * Runs one gate command under a timeout, re-running it while a crash or the
 * ceiling is the only thing red about it. Re-runs never spend the fix budget.
 */
export const createGateRunner = ({ cwd, timeoutMs, runId, step, onGateResult, onProgress, onGateSpawn, onGateExit }: Params): RunGate => {
	const ceilingMinutes = timeoutMs / 60_000;

	const executeOnce = async ({ kind, command, group, rerun }: { kind: string; command: string; group: string; rerun?: boolean }) => {
		const evidence = await prepareEvidence({ cwd, runId, step, kind, group });
		const startedAt = Date.now();
		const { result, timedOut } = await spawnAttempt({ command, cwd, timeoutMs, env: evidence?.env, onGateSpawn, onGateExit });
		const ending = classifyGateEnding({ kind, result, timedOut });
		const policy = noVerdictPolicy({ ending, ceilingMinutes });

		onProgress?.(
			`gate [${group}] ${kind}${rerun ? ' (re-run)' : ''}: exit ${result.exitCode}${policy ? ` (${policy.suffix})` : ''} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
		);

		const gateResult = buildGateResult({
			cwd,
			kind,
			group,
			command,
			result,
			durationMs: Date.now() - startedAt,
			crashed: ending === GateEnding.Crashed,
			timedOut: ending === GateEnding.Timeout,
			rerun,
			evidenceDir: evidence?.dir,
		});

		if (runId) {
			await appendCommandLog({ cwd, runId, record: { at: new Date().toISOString(), step, ...gateResult } });
		}

		// The only lasting record of a crash or timeout that a re-run then recovered.
		if (policy && runId) {
			await appendFriction({
				cwd,
				runId,
				step: step ?? 'gates',
				friction: [{ area: FrictionArea.Environment, detail: `gate [${group}] ${kind} ${policy.friction}` }],
			});
		}

		onGateResult?.(gateResult);

		return { result, ending };
	};

	return async ({ kind, command, group }) => {
		const executions = new Map<GateEnding, number>();
		let outcome = await executeOnce({ kind, command, group });
		let rerun = false;

		// A crash or a timeout says nothing about the code, so re-run it.
		do {
			const count = (executions.get(outcome.ending) ?? 0) + 1;
			const policy = noVerdictPolicy({ ending: outcome.ending, ceilingMinutes });

			executions.set(outcome.ending, count);
			rerun = policy !== undefined && count < policy.allowance;

			if (policy && rerun) {
				onProgress?.(`gate [${group}] ${kind}: ${policy.rerun} — re-running (attempt ${count + 1} of ${policy.allowance})`);
				outcome = await executeOnce({ kind, command, group, rerun: true });
			}
		} while (rerun);

		return { ...outcome.result, ending: outcome.ending, ceilingMinutes };
	};
};
