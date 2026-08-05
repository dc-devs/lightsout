import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { RunStatus } from '@/contracts';
import type { summarizeRun } from '@/runState';
import { printStepTable } from '@/cli/common/render/printStepTable';

type StepSummary = Awaited<ReturnType<typeof summarizeRun>>['steps'][number];

// The table's whole output IS its console.log lines, so capturing them is the
// arrangement. isTTY is pinned off so the ANSI paint helpers stay no-ops and
// the assertions read the plain text a piped consumer sees.
const setupStepTable = ({ t, steps }: { t: TestContext; steps: StepSummary[] }) => {
	const logged: string[] = [];
	const wasTty = process.stdout.isTTY;

	process.stdout.isTTY = false;
	t.after(() => {
		process.stdout.isTTY = wasTty;
	});

	t.mock.method(console, 'log', (...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	return { steps, logged };
};

/** Row cells with the alignment padding stripped — the content contract, read apart from the column widths the geometry test pins. */
const cellsOf = ({ logged }: { logged: string[] }) =>
	logged.filter((line) => line.startsWith('│')).map((line) => line.split('│').slice(1, -1).map((cell) => cell.trim()));

test('printStepTable: a step with agent activity fills every column, and the total row sums the steps', (t) => {
	const { steps, logged } = setupStepTable({
		t,
		steps: [
			{ id: 'implement', status: RunStatus.Passed, attempts: 1, durationMs: 65000, changedFiles: ['src/a.ts', 'src/b.ts'], invocations: 2, outputTokens: 1500, costUsd: 0.5 },
			{ id: 'write-tests', status: RunStatus.Pending, attempts: 0, durationMs: undefined, changedFiles: undefined, invocations: 0, outputTokens: 0, costUsd: 0 },
		],
	});

	printStepTable({ steps, activeMs: 65000 });

	assert.deepEqual(cellsOf({ logged }), [
		['step', 'tries', 'time', 'agents', 'out', 'cost', 'files'],
		['✓ implement', '1', '1m 05s', '2', '1.5k', '$0.50', '2'],
		['○ write-tests', '0', '—', '—', '—', '—', '—'],
		['total', '—', '1m 05s', '2', '1.5k', '$0.50', '2'],
	]);
});

test('printStepTable: a run with no agent invocations dashes out the agent columns, and an explicit empty change list still counts as zero', (t) => {
	const { steps, logged } = setupStepTable({
		t,
		steps: [{ id: 'clean-slate', status: RunStatus.Failed, attempts: 2, durationMs: undefined, changedFiles: [], invocations: 0, outputTokens: 0, costUsd: 0 }],
	});

	printStepTable({ steps, activeMs: 0 });

	assert.deepEqual(cellsOf({ logged }), [
		['step', 'tries', 'time', 'agents', 'out', 'cost', 'files'],
		['✗ clean-slate', '2', '—', '—', '—', '—', '0'],
		['total', '—', '—', '—', '—', '—', '0'],
	]);
});

test('printStepTable: a status with no icon of its own falls back to a question mark rather than blanking the cell', (t) => {
	const { steps, logged } = setupStepTable({
		t,
		steps: [{ id: 'park', status: RunStatus.PausedBudget, attempts: 1, durationMs: undefined, changedFiles: undefined, invocations: 0, outputTokens: 0, costUsd: 0 }],
	});

	printStepTable({ steps, activeMs: 0 });

	assert.deepEqual(cellsOf({ logged })[1], ['? park', '1', '—', '—', '—', '—', '—']);
});

test('printStepTable: a run with no steps still prints the header and a zeroed total row', (t) => {
	const { steps, logged } = setupStepTable({ t, steps: [] });

	printStepTable({ steps, activeMs: 0 });

	assert.deepEqual(cellsOf({ logged }), [
		['step', 'tries', 'time', 'agents', 'out', 'cost', 'files'],
		['total', '—', '—', '—', '—', '—', '0'],
	]);
});

test('printStepTable: every rule and row is padded to one width, so the box closes over seven columns', (t) => {
	const { steps, logged } = setupStepTable({
		t,
		steps: [{ id: 'implement', status: RunStatus.Passed, attempts: 1, durationMs: 1000, changedFiles: ['src/a.ts'], invocations: 1, outputTokens: 100, costUsd: 0.01 }],
	});

	printStepTable({ steps, activeMs: 1000 });

	assert.deepEqual([...new Set(logged.map((line) => line.length))], [logged[0]?.length]);
	assert.match(logged[0] ?? '', /^┌─+(┬─+){6}┐$/);
	assert.match(logged.at(-1) ?? '', /^└─+(┴─+){6}┘$/);
});
