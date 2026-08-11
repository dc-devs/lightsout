import type { ChildProcess } from 'node:child_process';

interface Params {
	/** A child spawned with `detached: true`, so its pid is also its group id. */
	child: ChildProcess;
	signal: NodeJS.Signals;
}

/**
 * Signal a child and everything it started.
 *
 * `child.kill()` reaches exactly one process. A harness that spawned a tool, or
 * a gate command like `pnpm test` that spawned a whole runner, leaves those
 * descendants alive — reparented to init, still holding the stdout pipe they
 * inherited, still burning CPU that nobody is left to reap. Signalling the
 * process GROUP reaches all of them in one call, which is what a shell does
 * when you press Ctrl-C, and it cannot race a process spawned mid-sweep the way
 * walking a process tree can.
 *
 * A group whose leader has already exited is the ordinary case, not a failure —
 * the signal is simply dropped. Windows has no POSIX process groups, so the
 * direct child is signalled there and its descendants are left; saying so is
 * better than pretending the platforms behave alike.
 */
export const killProcessGroup = ({ child, signal }: Params): void => {
	if (child.pid !== undefined && process.platform !== 'win32') {
		try {
			process.kill(-child.pid, signal);

			return;
		} catch {
			// No such group: either it is already gone, or this child was not
			// spawned detached and so leads no group. The second case must still
			// kill something, so fall through rather than return.
		}
	}

	try {
		child.kill(signal);
	} catch {
		// already gone
	}
};
