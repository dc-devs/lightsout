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

/**
 * Executions one gate gets before a repeating worker crash is called
 * unabsorbable.
 *
 * One re-run was not enough: the crash has landed on a gate and on its re-run
 * in the same pair, which failed the step over a suite that was not broken.
 * Named because the number is announced in the progress line and in the
 * friction entry as well as spent in the loop.
 */
const maxCrashAttempts = 3;

/**
 * Executions one gate gets before running past its ceiling is called a
 * timeout.
 *
 * One re-run recovers the transient case — a gate that hit the ceiling on a
 * loaded machine has passed on its very next run — and each re-run costs a
 * full ceiling, so a gate that runs past it twice is stopped and reported
 * rather than waited on again.
 */
const maxTimeoutAttempts = 2;

/**
 * One execution's per-test evidence slot: the reporter file the run folder holds,
 * and a directory of its own, cleared and recreated before the command starts so
 * a re-run after a worker crash is never judged on the crashed attempt's results.
 *
 * Without a run folder there is nothing to write into, so no variables are set
 * and the reporter stays inert — which is also what an ordinary developer run
 * looks like from the consumer's side.
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

/**
 * One execution of a gate command, settled to a result either way: a rejection
 * becomes a synthetic exit -1, and `timedOut` says whether the deadline — not a
 * failed spawn — was what rejected.
 */
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
	// The pairing is strict: an exit is reported only for an attempt that
	// produced a pid. A spawn that failed outright never does, and reporting
	// one for it would either write an undefined into the reservation's group
	// list or drop another attempt's entry — and that list is what the reclaim
	// rule reads before the machine is handed to a second run.
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
		// The runner's own error text stays the output tail. A gate that failed
		// to spawn is an ordinary red; one the deadline stopped is told apart by
		// the flag its `onTimeout` set, not by this text.
		result = { exitCode: -1, stdout: '', stderr: messageOf({ error }) };
	}

	if (spawnedPid !== undefined) {
		onGateExit?.({ pid: spawnedPid });
	}

	return { result, timedOut };
};

/**
 * How a no-verdict ending is re-run and narrated, or nothing for an ending that
 * returned a verdict. Each ending carries its own allowance, so a crash and a
 * timeout on one gate never draw on one shared count.
 */
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
 * The engine's gate-execution policy, as a single reusable `RunGate`: run a
 * command under a hard timeout, re-run it while a test-runner crash or the
 * ceiling is the only thing red about it, and record the same evidence to both
 * sinks. Every re-run happens under the reservation `runGates` already holds,
 * and none of them is the fix budget — only a gate that failed spends that.
 *
 * Split out of `runGates` so that function is left dispatching between the
 * root and scoped groups — how one command is executed and recorded is a
 * separate decision from which commands a repo runs, and both groups share it
 * exactly. A module internal; its behaviour is pinned through `runGates`' own
 * tests, where the crash and timeout re-runs and evidence entries are asserted.
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

		// A re-run that goes green leaves the run's verdict untouched, so this
		// durable entry is the only place an operator can later see that the
		// toolchain or the ceiling, not the code, cost the run a gate.
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

		// A jest worker can die in V8's garbage collector (nodejs/node#62393) and
		// take down whichever suite it happened to hold, in a repository that does
		// not run Jest under `--no-sparkplug`, and a loaded machine can hold a gate
		// past its ceiling.
		// Neither red says anything about the code, so each is re-run on its own
		// allowance — a crash more than once, because it has landed twice in a row
		// on the same gate. Every other ending is returned immediately.
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
