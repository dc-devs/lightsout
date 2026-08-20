import type { ChildProcess } from 'node:child_process';
import { killGraceMs } from '#src/common/constants/killGraceMs.ts';
import type { CommandResult } from '#src/common/types/CommandResult.ts';
import { killProcessGroup } from '#src/common/utils/killProcessGroup.ts';
import { relayShutdownSignals } from '#src/common/utils/relayShutdownSignals.ts';

interface Params {
	/** An already-spawned child whose stdout and stderr are piped. */
	child: ChildProcess;
	/** Kill-and-reject deadline. Duration and message travel together so a timeout can never be armed without one. */
	timeout?: { ms: number; message: string };
	/** Called once per complete stdout line as it arrives (blank lines skipped). Full stdout is still collected and returned. */
	onStdoutLine?: (line: string) => void;
}

/**
 * Wire a spawned child's streams into one promise: collect stdout and stderr,
 * optionally stream complete stdout lines as they arrive, arm a SIGKILL
 * deadline, and settle on close. A non-zero exit is a result, not an
 * exception — only a spawn error or the deadline rejects; a signalled death
 * carries no code, so it reports -1.
 *
 * Every process the engine runs goes through here — consumer gate commands and
 * harness spawns alike — so the settle rules (what counts as failure, when the
 * timer clears, that a partial trailing line is flushed) are written once
 * rather than re-derived per caller. What differs between callers is how the
 * child is spawned, which is the caller's business.
 */
export const collectChildOutput = ({ child, timeout, onStdoutLine }: Params): Promise<CommandResult> => {
	return new Promise<CommandResult>((resolve, reject) => {
		let stdout = '';
		let stderr = '';
		let lineBuffer = '';

		// Chunks split anywhere, so a trailing partial line is held back until
		// the next chunk completes it — except on flush, where close has proven
		// no more is coming and the remainder is a whole line.
		const emitLines = ({ text, flush = false }: { text: string; flush?: boolean }) => {
			if (!onStdoutLine) {
				return;
			}

			lineBuffer += text;

			const lines = lineBuffer.split('\n');

			lineBuffer = flush ? '' : (lines.pop() ?? '');

			for (const line of lines) {
				if (line.trim()) {
					onStdoutLine(line);
				}
			}
		};

		// SIGTERM first, SIGKILL only if it is ignored: SIGKILL cannot be caught,
		// so leading with it denies the harness the chance to flush a transcript
		// or delete the temp files it owns. The caller is rejected at the
		// deadline either way — the escalation runs behind it, on an unref'd
		// timer so a pending SIGKILL can never be the reason a process lingers.
		const expire = () => {
			killProcessGroup({ child, signal: 'SIGTERM' });

			const escalation = setTimeout(() => killProcessGroup({ child, signal: 'SIGKILL' }), killGraceMs);

			escalation.unref();
			child.once('close', () => clearTimeout(escalation));
			reject(new Error(timeout?.message ?? 'timed out'));
		};

		const timer = timeout ? setTimeout(expire, timeout.ms) : undefined;
		const stopRelay = relayShutdownSignals({ child });

		child.stdout?.on('data', (chunk: Buffer) => {
			const text = chunk.toString();

			stdout += text;
			emitLines({ text });
		});

		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on('error', (error) => {
			clearTimeout(timer);
			stopRelay();
			reject(error);
		});

		child.on('close', (code) => {
			clearTimeout(timer);
			stopRelay();
			emitLines({ text: '', flush: true });
			resolve({ exitCode: code ?? -1, stdout, stderr });
		});
	});
};
