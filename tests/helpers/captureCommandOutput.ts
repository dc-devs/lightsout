import type { TestContext } from 'node:test';

interface Params {
	t: TestContext;
}

/**
 * Capture what a CLI command writes and how it ends — the whole observable
 * surface of a command, which returns nothing. `process.exit` never returns, so
 * the mock throws: one that returned would let the command body run on past a
 * fatal exit and assert output the real CLI never produces. isTTY is pinned off
 * so the ANSI paint helpers stay no-ops and the assertions read the plain text a
 * piped consumer sees. `t.mock.method` restores every original when the test ends.
 */
export const captureCommandOutput = ({ t }: Params) => {
	const logged: string[] = [];
	const errors: string[] = [];
	const exitCodes: (number | string | null | undefined)[] = [];
	const wasTty = process.stdout.isTTY;

	process.stdout.isTTY = false;
	t.after(() => {
		process.stdout.isTTY = wasTty;
	});

	t.mock.method(console, 'log', (...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	t.mock.method(console, 'error', (...args: unknown[]) => {
		errors.push(String(args[0]));
	});

	t.mock.method(process, 'exit', (code?: number | string | null): never => {
		exitCodes.push(code);

		throw new Error('process.exit');
	});

	return { logged, errors, exitCodes };
};
