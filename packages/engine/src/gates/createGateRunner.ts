import { runCommand } from '#src/common/processes/runCommand.ts';
import type { CommandResult } from '#src/common/types/CommandResult.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { GateResult } from '#src/contracts/index.ts';
import type { RunGate } from '#src/gates/common/types/RunGate.ts';
import { appendCommandLog } from '#src/runState/index.ts';

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

const isKnownJestWorkerSigsegv = ({ result }: { result: CommandResult }) => {
	const output = `${result.stdout}\n${result.stderr}`;

	return /A jest worker process \(pid=\d+\) was terminated by another process: signal=SIGSEGV, exitCode=null\./.test(output);
};

/**
 * The engine's gate-execution policy, as a single reusable `RunGate`: run a
 * command under a hard timeout and record the same evidence to both sinks.
 *
 * Split out of `runGates` so that function is left dispatching between the
 * root and scoped groups — how one command is executed and recorded is a
 * separate decision from which commands a repo runs, and both groups share it
 * exactly. A module internal; its behaviour is pinned through `runGates`' own
 * tests, where the temporary Jest crash workaround and evidence entries are
 * asserted.
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
		let finalResult = first;

		// Temporary workaround for a known Jest worker crash: retry this exact
		// SIGSEGV signature once while the upstream instability remains. All
		// other red gates are deterministic evidence and must return immediately.
		if (first.exitCode !== 0 && first.exitCode !== -1 && isKnownJestWorkerSigsegv({ result: first })) {
			onProgress?.(`gate [${group}] ${kind}: Jest worker SIGSEGV — re-running once as a temporary workaround`);
			finalResult = await executeOnce({ kind, command, group, rerun: true });
		}

		return finalResult;
	};
};
