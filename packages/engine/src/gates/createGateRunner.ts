import { runCommand } from '#src/common/processes/runCommand.ts';
import type { CommandResult } from '#src/common/types/CommandResult.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { FrictionArea, type GateResult } from '#src/contracts/index.ts';
import type { RunGate } from '#src/gates/common/types/RunGate.ts';
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
 * A red that is the known V8 worker segfault and nothing else.
 *
 * The crash is reported against whichever suite the dead worker happened to
 * hold, so it reads like a broken test and is not one. A run that also tallies
 * a failing test is NOT this: that failure is real evidence about the code, and
 * absorbing the red would hide it.
 */
const isWorkerCrash = ({ result }: { result: CommandResult }) => {
	const output = `${result.stdout}\n${result.stderr}`;

	// exit -1 is the runner's own timeout/spawn failure, which carries no gate
	// output to judge.
	return result.exitCode !== 0 && result.exitCode !== -1 && jestWorkerSigsegv.test(output) && !reportedTestFailure.test(output);
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
export const createGateRunner = ({ cwd, timeoutMs, runId, step, onGateResult, onProgress }: Params): RunGate => {
	const executeOnce = async ({ kind, command, group, rerun }: { kind: string; command: string; group: string; rerun?: boolean }) => {
		const outputTailChars = 2000;
		const startedAt = Date.now();
		let result: CommandResult;

		try {
			result = await runCommand({ command, cwd, timeoutMs });
		} catch (error) {
			// A gate that times out or fails to spawn is a red gate, not a crash.
			result = { exitCode: -1, stdout: '', stderr: messageOf({ error }) };
		}

		const crashed = isWorkerCrash({ result });

		onProgress?.(
			`gate [${group}] ${kind}${rerun ? ' (re-run)' : ''}: exit ${result.exitCode}${crashed ? ' (jest worker crash)' : ''} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
		);

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
			...(crashed ? { crashed: true } : {}),
			...(result.exitCode === 0 ? {} : { outputTail: `${result.stdout}\n${result.stderr}`.slice(-outputTailChars) }),
		};

		if (runId) {
			await appendCommandLog({ cwd, runId, record: { at: new Date().toISOString(), step, ...gateResult } });
		}

		// Even an absorbed crash is written down. A re-run that goes green
		// leaves the run's verdict untouched, so this durable entry is the only
		// place an operator can later see that the toolchain, not the code,
		// cost the run a gate.
		if (crashed && runId) {
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
		}

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
