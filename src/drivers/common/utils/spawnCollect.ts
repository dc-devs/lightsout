import { spawn } from 'node:child_process';
import type { CommandResult } from '@/common/types/CommandResult';
import { collectChildOutput } from '@/common/utils/collectChildOutput';

interface Params {
	command: string;
	args: string[];
	cwd: string;
	/** Written to the child's stdin, then closed. Sidesteps argv length limits for large prompts. */
	stdinText?: string;
	timeoutMs?: number;
	/** Called once per complete stdout line as it arrives (empty lines skipped). Full stdout is still collected and returned. */
	onStdoutLine?: (line: string) => void;
}

/**
 * Spawn a harness process, feed stdin, collect output. Rejects on spawn
 * failure or timeout; an exit code is a result, not an exception — the
 * caller owns what it means.
 */
export const spawnCollect = ({ command, args, cwd, stdinText, timeoutMs, onStdoutLine }: Params): Promise<CommandResult> => {
	// `env` is passed explicitly rather than left to ambient inheritance — see
	// the same note in runCommand. It is inert in production and is what makes
	// the harness binary stubbable from a test: without it, a test that empties
	// PATH still spawns the real harness, which costs real money.
	// `detached` puts the harness at the head of its own process group, so a
	// timeout kills the tools it spawned along with it. See the same note in
	// runCommand.
	const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env, detached: true });

	// Listeners attach before stdin is written, so a harness that answers
	// immediately cannot out-run the collector.
	const collected = collectChildOutput({
		child,
		timeout: timeoutMs ? { ms: timeoutMs, message: `${command} timed out after ${timeoutMs}ms` } : undefined,
		onStdoutLine,
	});

	if (stdinText !== undefined) {
		child.stdin?.write(stdinText);
	}

	child.stdin?.end();

	return collected;
};
