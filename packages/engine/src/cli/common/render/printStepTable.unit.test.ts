import { expect, jest, test } from '@jest/globals';
import { printStepTable } from '#src/cli/common/render/printStepTable.ts';
import { RunStatus } from '#src/contracts/index.ts';
import type { StepSummary } from '#src/runState/index.ts';

// The table's whole output IS its console.log lines, so capturing them is the
// arrangement. isTTY is pinned off so the ANSI paint helpers stay no-ops and
// the assertions read the plain text a piped consumer sees.
const setupStepTable = ({ steps }: { steps: StepSummary[] }) => {
	const logged: string[] = [];

	process.stdout.isTTY = false;

	jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	return { steps, logged };
};

/** Row cells with the alignment padding stripped — the content contract, read apart from the column widths the geometry test pins. */
const cellsOf = ({ logged }: { logged: string[] }) =>
	logged
		.filter((line) => line.startsWith('│'))
		.map((line) =>
			line
				.split('│')
				.slice(1, -1)
				.map((cell) => cell.trim()),
		);

test('printStepTable: a step with agent activity fills every column, and the total row sums the steps', () => {
	const { steps, logged } = setupStepTable({
		steps: [
			{
				id: 'implement',
				status: RunStatus.Passed,
				attempts: 1,
				durationMs: 65000,
				changedFiles: ['src/a.ts', 'src/b.ts'],
				invocations: 2,
				outputTokens: 1500,
				costUsd: 0.5,
			},
			{
				id: 'write-tests',
				status: RunStatus.Pending,
				attempts: 0,
				durationMs: undefined,
				changedFiles: undefined,
				invocations: 0,
				outputTokens: 0,
				costUsd: 0,
			},
		],
	});

	printStepTable({ steps, activeMs: 65000 });

	expect(cellsOf({ logged })).toStrictEqual([
		['step', 'tries', 'time', 'agents', 'out', 'cost', 'files'],
		['✓ implement', '1', '1m 05s', '2', '1.5k', '$0.50', '2'],
		['○ write-tests', '0', '—', '—', '—', '—', '—'],
		['total', '—', '1m 05s', '2', '1.5k', '$0.50', '2'],
	]);
});

test('printStepTable: a run with no agent invocations dashes out the agent columns, and an explicit empty change list still counts as zero', () => {
	const { steps, logged } = setupStepTable({
		steps: [{ id: 'clean-slate', status: RunStatus.Failed, attempts: 2, durationMs: undefined, changedFiles: [], invocations: 0, outputTokens: 0, costUsd: 0 }],
	});

	printStepTable({ steps, activeMs: 0 });

	expect(cellsOf({ logged })).toStrictEqual([
		['step', 'tries', 'time', 'agents', 'out', 'cost', 'files'],
		['✗ clean-slate', '2', '—', '—', '—', '—', '0'],
		['total', '—', '—', '—', '—', '—', '0'],
	]);
});

test('printStepTable: a status this build has no icon for falls back to a question mark rather than blanking the cell', () => {
	const { steps, logged } = setupStepTable({
		// Every status in the union has an icon — the table is typed to make sure
		// of it. This is the case that outlives that guarantee: a manifest written
		// by a newer build, read back by an older one, carries a status string this
		// build has never heard of. Cast, because no honest value can express it.
		steps: [
			{
				id: 'park',
				status: 'from-a-later-build' as RunStatus,
				attempts: 1,
				durationMs: undefined,
				changedFiles: undefined,
				invocations: 0,
				outputTokens: 0,
				costUsd: 0,
			},
		],
	});

	printStepTable({ steps, activeMs: 0 });

	expect(cellsOf({ logged })[1]).toStrictEqual(['? park', '1', '—', '—', '—', '—', '—']);
});

test('printStepTable: a run with no steps still prints the header and a zeroed total row', () => {
	const { steps, logged } = setupStepTable({ steps: [] });

	printStepTable({ steps, activeMs: 0 });

	expect(cellsOf({ logged })).toStrictEqual([
		['step', 'tries', 'time', 'agents', 'out', 'cost', 'files'],
		['total', '—', '—', '—', '—', '—', '0'],
	]);
});

test('printStepTable: every rule and row is padded to one width, so the box closes over seven columns', () => {
	const { steps, logged } = setupStepTable({
		steps: [
			{
				id: 'implement',
				status: RunStatus.Passed,
				attempts: 1,
				durationMs: 1000,
				changedFiles: ['src/a.ts'],
				invocations: 1,
				outputTokens: 100,
				costUsd: 0.01,
			},
		],
	});

	printStepTable({ steps, activeMs: 1000 });

	expect([...new Set(logged.map((line) => line.length))]).toStrictEqual([logged[0]?.length]);
	expect(logged[0] ?? '').toMatch(/^┌─+(┬─+){6}┐$/);
	expect(logged.at(-1) ?? '').toMatch(/^└─+(┴─+){6}┘$/);
});
