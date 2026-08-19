interface Params {
	pid: number;
}

/** Probe with signal 0 (no signal sent). EPERM means the pid exists but belongs to another user — still alive. */
export const isPidAlive = ({ pid }: Params): boolean => {
	try {
		process.kill(pid, 0);

		return true;
	} catch (error) {
		return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM';
	}
};
