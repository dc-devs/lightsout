interface Params {
	pid: number;
}

/** Probe with signal 0 (no signal sent). EPERM means the pid exists but belongs to another user — still alive. */
export const isPidAlive = ({ pid }: Params) => {
	try {
		process.kill(pid, 0);

		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
};
