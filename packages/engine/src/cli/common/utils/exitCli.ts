interface Params {
	code: number;
}

/**
 * Exit the process, but only after stdout and stderr have drained.
 *
 * `process.exit` discards whatever the pipes have not accepted yet, and a
 * pipe's kernel buffer is 64KB on Linux — while the ledger table alone is
 * ~150KB. A reader slow to drain (a CI runner collecting a subprocess's
 * output) would otherwise receive a table truncated wherever scheduling
 * happened to cut it.
 *
 * The empty write is the drain signal: stream write callbacks fire in
 * order, so this one runs only after everything queued before it has been
 * accepted by the pipe.
 */
export const exitCli = async ({ code }: Params): Promise<never> => {
	await Promise.all([process.stdout, process.stderr].map((stream) => new Promise<void>((resolve) => stream.write('', () => resolve()))));

	return process.exit(code);
};
