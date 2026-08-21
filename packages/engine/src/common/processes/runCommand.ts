import { spawn } from 'node:child_process';
import { collectChildOutput } from '#src/common/processes/collectChildOutput.ts';
import type { CommandResult } from '#src/common/types/CommandResult.ts';

interface Params {
	/** Full shell command from consumer config (e.g. `pnpm --filter api check`). */
	command: string;
	cwd: string;
	timeoutMs?: number;
}

/**
 * The verification gate primitive. Runs a consumer-configured command and
 * returns its exit code — the one signal in the pipeline no model can
 * sweet-talk. Rejects only on spawn failure or timeout; a non-zero exit is a
 * result, not an exception (the engine owns what failure means).
 */
export const runCommand = ({ command, cwd, timeoutMs }: Params): Promise<CommandResult> => {
	// `env` is passed explicitly rather than left to ambient inheritance. In
	// production this is identical — the child inherited exactly these values
	// anyway — but it makes the environment a visible input, which is what lets
	// a test stub a binary onto PATH. Some runners (Jest) hand test code a copy
	// of process.env that real child processes do not inherit, so without this
	// a PATH-stubbing test silently probes the machine instead of its fixture.
	// `detached` makes the shell its own process-group leader, so a gate that
	// blows its deadline can be killed WITH the tree it started. Without it,
	// killing `pnpm test` leaves the test runner underneath it running on a
	// machine nobody is watching. Ctrl-C still reaches it — collectChildOutput
	// relays the signal, which is the job the terminal's foreground group did
	// before the child left it.
	const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env, detached: true });

	return collectChildOutput({
		child,
		timeout: timeoutMs ? { ms: timeoutMs, message: `command timed out after ${timeoutMs}ms: ${command}` } : undefined,
	});
};
