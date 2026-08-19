import type { CommandResult } from '@/common/types/CommandResult';
import { messageOf } from '@/common/utils/messageOf';
import { runCommand } from '@/common/utils/runCommand';
import type { GateResult } from '@/contracts';
import type { RunGate } from '@/pipeline/common/types/RunGate';
import { appendCommandLog } from '@/runState';

interface Params {
	cwd: string;
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
 * The engine's gate-execution policy, as a single reusable `RunGate`: run a
 * command under a hard timeout, record the same evidence to both sinks, and
 * allow exactly one mechanical re-run before a red verdict.
 *
 * Split out of `runGates` so that function is left dispatching between the
 * root and scoped groups — how one command is executed and recorded is a
 * separate decision from which commands a repo runs, and both groups share it
 * exactly. A module internal; its behaviour is pinned through `runGates`' own
 * tests, where the flake re-run and the evidence entries are asserted.
 */
export const createGateRunner = ({ cwd, runId, step, onGateResult, onProgress }: Params): RunGate => {
	const executeOnce = async ({ kind, command, group, rerun }: { kind: string; command: string; group: string; rerun?: boolean }) => {
		const gateTimeoutMs = 10 * 60_000;
		const outputTailChars = 2000;
		const startedAt = Date.now();
		let result: CommandResult;

		try {
			result = await runCommand({ command, cwd, timeoutMs: gateTimeoutMs });
		} catch (error) {
			// A gate that times out or fails to spawn is a red gate, not a crash.
			result = { exitCode: -1, stdout: '', stderr: messageOf({ error }) };
		}

		onProgress?.(`gate [${group}] ${kind}${rerun ? ' (re-run)' : ''}: exit ${result.exitCode} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);

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
			...(result.exitCode === 0 ? {} : { outputTail: `${result.stdout}\n${result.stderr}`.slice(-outputTailChars) }),
		};

		if (runId) {
			await appendCommandLog({ cwd, runId, record: { at: new Date().toISOString(), step, ...gateResult } });
		}

		onGateResult?.(gateResult);

		return result;
	};

	return async ({ kind, command, group }) => {
		const first = await executeOnce({ kind, command, group });

		// One mechanical re-run before a red verdict — a single flaky worker
		// crash in a big suite (observed: jest SIGSEGV zeroing coverage) must
		// not fail a long run at the finish line. Two consecutive reds are a
		// genuine red. Synthetic -1 results (spawn failure, timeout) don't
		// re-run: repeating a 10-minute timeout only doubles the cost of
		// learning the ceiling is too low, and both executions are in the log.
		if (first.exitCode === 0 || first.exitCode === -1) {
			return first;
		}

		onProgress?.(`gate [${group}] ${kind}: red (exit ${first.exitCode}) — re-running once to rule out flake`);

		return executeOnce({ kind, command, group, rerun: true });
	};
};
