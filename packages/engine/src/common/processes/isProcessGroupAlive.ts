interface Params {
	/** A process-group id — the pid of a shell spawned `detached`, which leads the group it started. */
	pgid: number;
}

/**
 * Whether any process in a group is still running.
 *
 * Every gate command is spawned `detached`, so a killed engine leaves its gates
 * alive with nothing to reap them. That is why a dead holder pid is not on its
 * own proof that the machine is free: the groups it recorded have to be gone
 * too.
 *
 * Signal 0 sends nothing and only probes, and `EPERM` means the group exists but
 * belongs to another user — still alive. Windows has no POSIX process groups,
 * so the pid itself is probed there and its descendants are not seen; saying so
 * is better than pretending the platforms behave alike.
 */
export const isProcessGroupAlive = ({ pgid }: Params): boolean => {
	try {
		process.kill(process.platform === 'win32' ? pgid : -pgid, 0);

		return true;
	} catch (error) {
		return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM';
	}
};
