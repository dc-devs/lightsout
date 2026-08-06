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

	jest.spyOn(process, 'exit').mockImplementation((code?: number | string | null): never => {
		exitCodes.push(code);

		throw new Error('process.exit');
	});

	return { logged, errors, exitCodes };
};
