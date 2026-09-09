import { mkdir, rm } from 'node:fs/promises';
import { testReporterEnv } from '#src/common/constants/testReporterEnv.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import type { CommandResult } from '#src/common/types/CommandResult.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { FrictionArea, type GateResult } from '#src/contracts/index.ts';
import type { RunGate } from '#src/gates/common/types/RunGate.ts';
import { buildGateResult } from '#src/gates/common/utils/buildGateResult.ts';
import { testResultsDir, writeJestReporter } from '#src/gates/testResults/index.ts';
import { appendCommandLog, appendFriction } from '#src/runState/index.ts';

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

const jestWorkerSigsegv = /A jest worker process \(pid=\d+\) was terminated by another process: signal=SIGSEGV, exitCode=null\./;

// Jest's own tally line: `Tests:  1 failed, 5 passed, 6 total`. `Test Suites:`
// is a different line and does not match — the crashed suite is always counted
// failed there, so reading it would call every crash a real failure.
const reportedTestFailure = /\bTests:[ \t]+[^\n]*\d+ failed/;

/**
 * Gate kinds whose command is a test runner.
 *
 * Only these are judged by whether they tallied a failing test, because only
 * these produce such a tally: `check` and `build` never print one, so the same
 * reasoning would call every lint error a crash.
 */
const testKinds = new Set(['test', 'testCoverage', 'extraTests']);

// Jest's suite line, which it prints whenever it got far enough to report at
// all. Its presence is what says the runner ran; a test command that failed
// without it is some other tool failing for some other reason, and is ordinary
// evidence rather than a death.
const jestReported = /\bTest Suites:[ \t]+/;

/**
 * A red that is a dead test runner rather than evidence about the code.
 *
 * Two shapes, both seen on 2026-09-04 in one twenty-run sample. In the first
 * the worker dies and Jest survives to say so, which is the SIGSEGV line above.
 * In the second Jest itself goes down: the package prints its banner and then
 * nothing — no summary, no error, no signal named — and the run goes red having
 * never tallied a failing test. The first was already absorbed; the second was
 * reported as a broken suite and escalated the run.
 *
 * So the rule is the tally rather than the signature: a test gate that went red
 * without a single failing test did not fail, it died. A run that DOES tally a
 * failure is never this — that failure is real evidence about the code, and
 * absorbing the red would hide it.
 *
 * A test command that failed without Jest reporting at all is left alone: that
 * is some other tool failing for some other reason, and its output is ordinary
 * evidence.
 *
 * The known cost: a test file too broken to run — a syntax error, a bad import —
 * makes Jest report a failed suite while tallying no failed test, so it is
 * re-run before it is believed. That spends two extra gate runs on a real
 * breakage, against escalating an entire run on a crash that was never about
 * the code.
 */
const isWorkerCrash = ({ kind, result }: { kind: string; result: CommandResult }) => {
	const output = `${result.stdout}\n${result.stderr}`;

	// exit -1 is the runner's own timeout/spawn failure, which carries no gate
	// output to judge.
	if (result.exitCode === 0 || result.exitCode === -1 || reportedTestFailure.test(output)) {
		return false;
	}

	return jestWorkerSigsegv.test(output) || (testKinds.has(kind) && jestReported.test(output));
};

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
	const dir = testResultsDir({ cwd, runId, step: step ?? 'gates', group, kind });

	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });

	return { dir, env: { [testReporterEnv.reporter]: reporterPath, [testReporterEnv.resultsDir]: dir } };
};

/**
 * Write an absorbed worker crash down, for a crashed attempt in a run that has
 * a run folder. Silent for every other execution.
 *
 * A re-run that goes green leaves the run's verdict untouched, so this durable
 * entry is the only place an operator can later see that the toolchain, not the
 * code, cost the run a gate.
 */
const recordCrashFriction = async ({
	cwd,
	runId,
	step,
	kind,
	group,
	crashed,
}: {
	cwd: string;
	runId?: string;
	step?: string;
	kind: string;
	group: string;
	crashed: boolean;
}) => {
	if (!crashed || !runId) {
		return;
	}

	await appendFriction({
		cwd,
		runId,
		step: step ?? 'gates',
		friction: [
			{
				area: FrictionArea.Environment,
				detail: `gate [${group}] ${kind} crashed: a jest worker was terminated by SIGSEGV with no failing test beside it — the known V8 worker crash, re-run up to ${maxCrashAttempts} times.`,
			},
		],
	});
};

/**
 * The engine's gate-execution policy, as a single reusable `RunGate`: run a
 * command under a hard timeout, re-run it while a known worker crash is the
 * only thing red about it, and record the same evidence to both sinks.
 *
 * Split out of `runGates` so that function is left dispatching between the
 * root and scoped groups — how one command is executed and recorded is a
 * separate decision from which commands a repo runs, and both groups share it
 * exactly. A module internal; its behaviour is pinned through `runGates`' own
 * tests, where the crash workaround and evidence entries are asserted.
 */
export const createGateRunner = ({ cwd, timeoutMs, runId, step, onGateResult, onProgress, onGateSpawn, onGateExit }: Params): RunGate => {
	const executeOnce = async ({ kind, command, group, rerun }: { kind: string; command: string; group: string; rerun?: boolean }) => {
		const evidence = await prepareEvidence({ cwd, runId, step, kind, group });
		const startedAt = Date.now();
		let result: CommandResult;
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
				env: evidence?.env,
				onSpawn: ({ pid }) => {
					spawnedPid = pid;
					onGateSpawn?.({ pid });
				},
			});
		} catch (error) {
			// A gate that times out or fails to spawn is a red gate, not a crash.
			result = { exitCode: -1, stdout: '', stderr: messageOf({ error }) };
		}

		if (spawnedPid !== undefined) {
			onGateExit?.({ pid: spawnedPid });
		}

		const crashed = isWorkerCrash({ kind, result });

		onProgress?.(
			`gate [${group}] ${kind}${rerun ? ' (re-run)' : ''}: exit ${result.exitCode}${crashed ? ' (jest worker crash)' : ''} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
		);

		const gateResult = buildGateResult({ cwd, kind, group, command, result, durationMs: Date.now() - startedAt, crashed, rerun, evidenceDir: evidence?.dir });

		if (runId) {
			await appendCommandLog({ cwd, runId, record: { at: new Date().toISOString(), step, ...gateResult } });
		}

		await recordCrashFriction({ cwd, runId, step, kind, group, crashed });

		onGateResult?.(gateResult);

		return { result, crashed };
	};

	return async ({ kind, command, group }) => {
		let attempt = 1;
		let outcome = await executeOnce({ kind, command, group });

		// A jest worker can segfault inside V8 and take down whichever suite it
		// happened to hold. That red says nothing about the code, so it is
		// re-run — more than once, because the crash has landed twice in a row
		// on the same gate. Every other red is deterministic evidence and
		// returns immediately.
		while (outcome.crashed && attempt < maxCrashAttempts) {
			attempt += 1;
			onProgress?.(`gate [${group}] ${kind}: jest worker crash, not a test failure — re-running (attempt ${attempt} of ${maxCrashAttempts})`);
			outcome = await executeOnce({ kind, command, group, rerun: true });
		}

		return outcome.crashed ? { ...outcome.result, crashed: true } : outcome.result;
	};
};
