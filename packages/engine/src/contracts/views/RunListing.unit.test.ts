import { describe, expect, test } from '@jest/globals';
import { RunListing } from '#src/contracts/index.ts';

const setupListing = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const row: Record<string, unknown> = {
		runId: '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0',
		shortId: '0f1e2d3c',
		pipeline: 'implement',
		status: 'passed',
		title: 'add-web-app',
		plan: 'docs/plans/add-web-app/plan.md',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T01:00:00.000Z',
		live: false,
		packages: ['engine'],
		stepsPassed: 3,
		stepCount: 3,
		changedFileCount: 12,
		resumable: false,
		...extra,
	};

	if (omit) {
		delete row[omit];
	}

	return { row };
};

const requiredFields = [
	'runId',
	'shortId',
	'pipeline',
	'status',
	'title',
	'plan',
	'createdAt',
	'updatedAt',
	'live',
	'packages',
	'stepsPassed',
	'stepCount',
	'changedFileCount',
	'resumable',
];

describe('RunListing', () => {
	test('a row parses to exactly its required fields — cost is the only optional and is not invented', () => {
		const { row } = setupListing();

		const parsed = RunListing.parse(row);

		expect(parsed).toStrictEqual({
			runId: '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0',
			shortId: '0f1e2d3c',
			pipeline: 'implement',
			status: 'passed',
			title: 'add-web-app',
			plan: 'docs/plans/add-web-app/plan.md',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T01:00:00.000Z',
			live: false,
			packages: ['engine'],
			stepsPassed: 3,
			stepCount: 3,
			changedFileCount: 12,
			resumable: false,
		});
	});

	test('every field but cost is required — a partial row would render a blank list line', () => {
		for (const field of requiredFields) {
			const { row } = setupListing({ omit: field });

			expect(RunListing.safeParse(row).success).toBe(false);
		}
	});

	test('costUsd is optional and a run-wide zero survives its own falsy value', () => {
		const { row } = setupListing({ extra: { costUsd: 0 } });

		const parsed = RunListing.parse(row);

		// a driver that reports no usage omits it; a driver that reports nothing spent
		// records zero, and the two must stay distinguishable
		expect(parsed.costUsd).toBe(0);
		expect(RunListing.parse(setupListing().row).costUsd).toBeUndefined();
	});

	test('status accepts every run status, including the two pausable ones', () => {
		for (const status of ['pending', 'running', 'passed', 'failed', 'paused-rate-limit', 'paused-budget', 'escalated']) {
			const { row } = setupListing({ extra: { status } });

			expect(RunListing.parse(row).status).toBe(status);
		}
	});

	test('a status outside the run-status set fails — the enum is closed', () => {
		const { row } = setupListing({ extra: { status: 'complete' } });

		// an unrecognized state would render as a badge the list has no colour for
		expect(RunListing.safeParse(row).success).toBe(false);
	});

	test('pipeline is an open string — a manifest naming a pipeline this build predates still lists', () => {
		for (const pipeline of ['implement', 'refactor', 'phases', 'coverage', 'something-newer']) {
			const { row } = setupListing({ extra: { pipeline } });

			// the discriminator is recorded verbatim; a run must never vanish from the
			// list because its pipeline name is unfamiliar
			expect(RunListing.parse(row).pipeline).toBe(pipeline);
		}
	});

	test('live and resumable must be booleans — a truthy string is refused rather than coerced', () => {
		for (const extra of [{ live: 'true' }, { resumable: 1 }, { live: null }]) {
			const { row } = setupListing({ extra });

			// both drive an action: one shows a running indicator, the other offers resume
			expect(RunListing.safeParse(row).success).toBe(false);
		}
	});

	test('a live, resumable row parses — a running run with no process behind it is both', () => {
		const { row } = setupListing({ extra: { status: 'running', live: true, resumable: true } });

		const parsed = RunListing.parse(row);

		expect(parsed).toEqual(expect.objectContaining({ status: 'running', live: true, resumable: true }));
	});

	test('the three counts must be numbers, not numeric strings', () => {
		for (const extra of [{ stepsPassed: '3' }, { stepCount: '3' }, { changedFileCount: '12' }, { costUsd: '0.5' }]) {
			const { row } = setupListing({ extra });

			// the list renders "2/5 steps" from these and sorts on the cost
			expect(RunListing.safeParse(row).success).toBe(false);
		}
	});

	test('a fresh run with nothing done yet parses with zeroed counts and no packages', () => {
		const { row } = setupListing({
			extra: { status: 'pending', packages: [], stepsPassed: 0, stepCount: 0, changedFileCount: 0 },
		});

		const parsed = RunListing.parse(row);

		expect(parsed).toEqual(expect.objectContaining({ packages: [], stepsPassed: 0, stepCount: 0, changedFileCount: 0 }));
	});

	test('packages must be a list of strings', () => {
		for (const packages of [['engine', 7], 'engine', null]) {
			const { row } = setupListing({ extra: { packages } });

			expect(RunListing.safeParse(row).success).toBe(false);
		}
	});

	test('the identity and label fields must be strings, not other types', () => {
		for (const extra of [{ runId: 7 }, { shortId: null }, { title: ['add-web-app'] }, { plan: 7 }, { createdAt: 0 }, { updatedAt: 0 }]) {
			const { row } = setupListing({ extra });

			expect(RunListing.safeParse(row).success).toBe(false);
		}
	});

	test('keys the contract does not declare are stripped — the row stays cheap to hold', () => {
		const { row } = setupListing({ extra: { steps: [{ id: 'implement' }], usage: { costUsd: 0.5 } } });

		const parsed = RunListing.parse(row);

		// anything that would require opening a JSONL file belongs to the detail view
		expect(Object.keys(parsed).sort()).toStrictEqual([...requiredFields].sort());
	});
});
