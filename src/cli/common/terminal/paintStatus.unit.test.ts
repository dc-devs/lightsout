import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { RunStatus } from '@/contracts';
import { paintStatus } from '@/cli/common/terminal/paintStatus';

// The colour is only observable on a TTY — piped output is the same text
// whatever the status — so the arrangement pins isTTY and restores it after.
const setupPaintStatus = ({ t, isTty = true }: { t: TestContext; isTty?: boolean }) => {
	const wasTty = process.stdout.isTTY;

	process.stdout.isTTY = isTty;
	t.after(() => {
		process.stdout.isTTY = wasTty;
	});

	return { text: 'implement' };
};

test('paintStatus: a passed run is green', (t) => {
	const { text } = setupPaintStatus({ t });

	const painted = paintStatus({ status: RunStatus.Passed, text });

	assert.equal(painted, '\u001b[32mimplement\u001b[0m');
});

test('paintStatus: a failed run is red', (t) => {
	const { text } = setupPaintStatus({ t });

	const painted = paintStatus({ status: RunStatus.Failed, text });

	assert.equal(painted, '\u001b[31mimplement\u001b[0m');
});

// Every status that is neither passed nor failed is in-flight or needs a human
// — one yellow bucket, so they share a code path and vary only by input.
for (const status of [RunStatus.Pending, RunStatus.Running, RunStatus.PausedRateLimit, RunStatus.PausedBudget, RunStatus.Escalated] as const) {
	test(`paintStatus: ${status} falls into the yellow bucket`, (t) => {
		const { text } = setupPaintStatus({ t });

		const painted = paintStatus({ status, text });

		assert.equal(painted, '\u001b[33mimplement\u001b[0m');
	});
}

test('paintStatus: an unrecognised status string is yellow rather than unpainted', (t) => {
	const { text } = setupPaintStatus({ t });

	const painted = paintStatus({ status: 'not-a-status', text });

	assert.equal(painted, '\u001b[33mimplement\u001b[0m');
});

test('paintStatus: piped output is the plain text for every status, so alignment is computed on unpainted width', (t) => {
	const { text } = setupPaintStatus({ t, isTty: false });

	const painted = [RunStatus.Passed, RunStatus.Failed, RunStatus.Running].map((status) => paintStatus({ status, text }));

	assert.deepEqual(painted, ['implement', 'implement', 'implement']);
});
