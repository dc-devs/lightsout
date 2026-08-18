import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { exitCli } from '@/cli/common/utils/exitCli';

/**
 * Capture each stream's queued write callbacks without writing anywhere, so
 * the test controls exactly when the pipes report themselves drained.
 */
const setupStreams = () => {
	const pending: (() => void)[] = [];
	const exits: number[] = [];

	const capture = (stream: NodeJS.WriteStream) =>
		jest.spyOn(stream, 'write').mockImplementation((_chunk, callback?) => {
			if (typeof callback === 'function') {
				pending.push(callback as () => void);
			}

			return true;
		});

	capture(process.stdout);
	capture(process.stderr);
	jest.spyOn(process, 'exit').mockImplementation(((code: number) => {
		exits.push(code);

		return undefined as never;
	}) as typeof process.exit);

	return { pending, exits };
};

describe('exitCli', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	test('the process ends only after both pipes have accepted everything queued before the exit', async () => {
		const { pending, exits } = setupStreams();

		// widened from Promise<never>: the mocked exit returns, so this resolves
		const exiting: Promise<unknown> = exitCli({ code: 1 });

		// both streams were asked to signal their drain, and neither has yet —
		// exiting now would hand a slow reader a truncated table
		await Promise.resolve();
		expect(pending).toHaveLength(2);
		expect(exits).toStrictEqual([]);

		for (const flush of pending) {
			flush();
		}

		await exiting;
		expect(exits).toStrictEqual([1]);
	});
});
