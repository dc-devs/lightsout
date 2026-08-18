/**
 * Exit the process, but only after stdout and stderr have drained.
 *
 * `process.exit` discards whatever the pipes have not accepted yet, and a
 * pipe's kernel buffer is 64KB on Linux — while the ledger table alone is
 * ~150KB. A reader that is slow to drain (CI collecting a subprocess's
 * output on a loaded runner) was handed a silently truncated table, and
 * which rows survived depended on scheduling luck (live lesson: the
 * `--list` e2e tests failing on different assertions across CI runs while
 * passing everywhere fast).
 *
 * The empty write is the drain signal: stream write callbacks fire in
 * order, so this one runs only after everything queued before it has been
 * accepted by the pipe.
 */
export const exitCli = async ({ code }: { code: number }): Promise<never> => {
	await Promise.all([process.stdout, process.stderr].map((stream) => new Promise<void>((resolve) => stream.write('', () => resolve()))));

	return process.exit(code);
};
