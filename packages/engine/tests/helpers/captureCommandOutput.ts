import { jest } from '@jest/globals';

/** What a CLI command wrote and how it ended — the captured observable surface. */
export interface CapturedCommandOutput {
	logged: string[];
	errors: string[];
	exitCodes: (number | string | null | undefined)[];
}

/**
 * Capture what a CLI command writes and how it ends — the whole observable
 * surface of a command, which returns nothing. `process.exit` never returns, so
 * the mock throws: one that returned would let the command body run on past a
 * fatal exit and assert output the real CLI never produces. isTTY is pinned off
 * so the ANSI paint helpers stay no-ops and the assertions read the plain text a
 * piped consumer sees. The Jest config restores every spy after each test, and
 * tests/config/setupTestEnvironment.ts restores isTTY.
 */
export const captureCommandOutput = (): CapturedCommandOutput => {
	const logged: string[] = [];
	const errors: string[] = [];
	const exitCodes: (number | string | null | undefined)[] = [];

	process.stdout.isTTY = false;

	jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		errors.push(String(args[0]));
	});

	// Console output is captured above; Jest's worker streams do not consistently
	// call back for an empty drain write. Model that unowned stream boundary while
	// leaving nonempty writes real. exitCli's own tests exercise drain ordering.
	for (const stream of [process.stdout, process.stderr]) {
		const write = stream.write.bind(stream);
		jest.spyOn(stream, 'write').mockImplementation((chunk, encoding, callback) => {
			if (chunk === '') {
				const complete = typeof encoding === 'function' ? encoding : callback;
				queueMicrotask(() => complete?.());
				return true;
			}
			return write(chunk, encoding, callback);
		});
	}

	jest.spyOn(process, 'exit').mockImplementation((code?: number | string | null): never => {
		exitCodes.push(code);

		throw new Error('process.exit');
	});

	return { logged, errors, exitCodes };
};
