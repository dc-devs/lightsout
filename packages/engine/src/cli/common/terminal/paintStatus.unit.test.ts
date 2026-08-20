import { expect, test } from '@jest/globals';
import { paintStatus } from '#src/cli/common/terminal/paintStatus.ts';
import { RunStatus } from '#src/contracts/index.ts';

// The colour is only observable on a TTY — piped output is the same text
// whatever the status — so the arrangement pins isTTY and restores it after.
const setupPaintStatus = ({ isTty = true }: { isTty?: boolean } = {}) => {
	process.stdout.isTTY = isTty;

	return { text: 'implement' };
};

test('paintStatus: a passed run is green', () => {
	const { text } = setupPaintStatus();

	const painted = paintStatus({ status: RunStatus.Passed, text });

	expect(painted).toBe('\u001b[32mimplement\u001b[0m');
});

test('paintStatus: a failed run is red', () => {
	const { text } = setupPaintStatus();

	const painted = paintStatus({ status: RunStatus.Failed, text });

	expect(painted).toBe('\u001b[31mimplement\u001b[0m');
});

// Every status that is neither passed nor failed is in-flight or needs a human
// — one yellow bucket, so they share a code path and vary only by input.
for (const status of [RunStatus.Pending, RunStatus.Running, RunStatus.PausedRateLimit, RunStatus.PausedBudget, RunStatus.Escalated] as const) {
	test(`paintStatus: ${status} falls into the yellow bucket`, () => {
		const { text } = setupPaintStatus();

		const painted = paintStatus({ status, text });

		expect(painted).toBe('\u001b[33mimplement\u001b[0m');
	});
}

test('paintStatus: an unrecognised status string is yellow rather than unpainted', () => {
	const { text } = setupPaintStatus();

	const painted = paintStatus({ status: 'not-a-status', text });

	expect(painted).toBe('\u001b[33mimplement\u001b[0m');
});

test('paintStatus: piped output is the plain text for every status, so alignment is computed on unpainted width', () => {
	const { text } = setupPaintStatus({ isTty: false });

	const painted = [RunStatus.Passed, RunStatus.Failed, RunStatus.Running].map((status) => paintStatus({ status, text }));

	expect(painted).toStrictEqual(['implement', 'implement', 'implement']);
});
