import { describe, expect, test } from '@jest/globals';
import { RunStatus, StandardsSeverity } from '#src/contracts/index.ts';
import { getRunView } from '#src/views/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

/** One frozen work-list batch, beside whatever the run recorded against it. */
interface BatchSpec {
	rule: string;
	/** How many blocking findings the work-list froze for this batch. */
	blocking: number;
	/** The step record's `report`; omitted, the run never reached this batch and wrote no step for it. */
	report?: unknown;
}

/** The step id a work-list batch and its manifest step share. */
const batchId = ({ rule, index }: { rule: string; index: number }) => `batch-0${index}:${rule}:src`;

/**
 * A refactor run on disk: a frozen work-list, and a manifest carrying a step
 * for every batch the run actually reached.
 *
 * The work-list is written even when `plan` points somewhere else, so a case
 * can prove the file is left unopened rather than merely absent.
 */
const setupRefactorRun = async ({
	batches = [],
	worklist,
	plan = '.lightsout/runs/run-refactor/worklist.json',
}: {
	batches?: BatchSpec[];
	worklist?: string;
	plan?: string;
} = {}) => {
	const cwd = await freshCwd();
	const frozen = JSON.stringify({
		at: '2026-01-01T00:00:00.000Z',
		path: '.',
		all: false,
		batches: batches.map((batch, index) => ({
			id: batchId({ rule: batch.rule, index }),
			rule: batch.rule,
			folder: 'src',
			blocking: Array.from({ length: batch.blocking }, (_unused, site) => ({
				rule: batch.rule,
				severity: StandardsSeverity.Blocking,
				siteKey: `${batch.rule}:${site}`,
				files: [{ path: `src/${batch.rule}-${site}.ts` }],
				detail: 'past the cap',
			})),
			advisories: [],
		})),
	});

	await seedRunDir({
		cwd,
		manifest: {
			runId: 'run-refactor',
			pipeline: 'refactor',
			plan,
			steps: batches.flatMap((batch, index) => {
				const step = { id: batchId({ rule: batch.rule, index }), status: RunStatus.Passed, attempts: 1, report: batch.report };

				return batch.report === undefined ? [] : [step];
			}),
		},
		worklist: worklist ?? frozen,
	});

	return { cwd };
};

/** A coverage run whose steps carry the reports given, in order, and no work-list file at all. */
const setupCoverageRun = async ({ reports }: { reports: unknown[] }) => {
	const cwd = await freshCwd();

	await seedRunDir({
		cwd,
		manifest: {
			runId: 'run-coverage',
			pipeline: 'coverage',
			plan: '.lightsout/runs/run-coverage/worklist.json',
			steps: reports.map((report, index) => ({ id: `batch-0${index}`, status: RunStatus.Passed, attempts: 1, report })),
		},
	});

	return { cwd };
};

describe('getRunView', () => {
	test('a refactor run reports every frozen site against the sites its batches left standing', async () => {
		const { cwd } = await setupRefactorRun({
			batches: [
				{ rule: 'size-file', blocking: 3, report: { outcome: 'resolved', remainingSiteKeys: [], rationale: [] } },
				{
					rule: 'crowded-folder',
					blocking: 2,
					report: {
						outcome: 'declined',
						remainingSiteKeys: ['crowded-folder:0', 'crowded-folder:1'],
						rationale: ['the folder is one public surface'],
						advisoryOutcomes: [{ rule: 'multi-export', siteKey: 'multi-export:0', outcome: 'declined', reason: 'the second export is the type' }],
					},
				},
				{ rule: 'multi-export', blocking: 4 },
			],
		});

		const view = await getRunView({ cwd, runId: 'run-refactor' });

		// nine sites froze; the resolved batch cleared three, the declined batch
		// kept its two, and the batch the run never reached still stands whole —
		// so a run that got through two of three reads as two thirds done, not done
		expect(view.burnDown).toStrictEqual({
			before: 9,
			after: 6,
			batchesResolved: 1,
			batchesDeclined: 1,
			batches: [
				// a report with no advisory list reports none, rather than nothing
				{ id: 'batch-00:size-file:src', rule: 'size-file', folder: 'src', blocking: 3, outcome: 'resolved', rationale: [], advisoryOutcomes: [] },
				{
					id: 'batch-01:crowded-folder:src',
					rule: 'crowded-folder',
					folder: 'src',
					blocking: 2,
					outcome: 'declined',
					rationale: ['the folder is one public surface'],
					advisoryOutcomes: [{ rule: 'multi-export', siteKey: 'multi-export:0', outcome: 'declined', reason: 'the second export is the type' }],
				},
				{ id: 'batch-02:multi-export:src', rule: 'multi-export', folder: 'src', blocking: 4, outcome: 'not-run', rationale: [], advisoryOutcomes: [] },
			],
			// only the size and crowding rules are the sprawl story: three plus two
			// sites, of which two still stand
			overCap: { before: 5, after: 2 },
		});
	});

	test('a batch whose recorded report will not parse reads as never run, leaving its sites standing', async () => {
		const { cwd } = await setupRefactorRun({ batches: [{ rule: 'size-function', blocking: 2, report: { outcome: 'exploded' } }] });

		const view = await getRunView({ cwd, runId: 'run-refactor' });

		// a report nobody can read is not a verdict, so it neither clears sites nor
		// counts toward either outcome
		expect(view.burnDown).toStrictEqual({
			before: 2,
			after: 2,
			batchesResolved: 0,
			batchesDeclined: 0,
			batches: [
				{ id: 'batch-00:size-function:src', rule: 'size-function', folder: 'src', blocking: 2, outcome: 'not-run', rationale: [], advisoryOutcomes: [] },
			],
			overCap: { before: 2, after: 2 },
		});
	});

	test('a work-list of nothing but other rules leaves the over-cap count off', async () => {
		const { cwd } = await setupRefactorRun({
			batches: [{ rule: 'multi-export', blocking: 1, report: { outcome: 'resolved', remainingSiteKeys: [], rationale: [] } }],
		});

		const view = await getRunView({ cwd, runId: 'run-refactor' });

		expect(view.burnDown).toStrictEqual({
			before: 1,
			after: 0,
			batchesResolved: 1,
			batchesDeclined: 0,
			batches: [
				{ id: 'batch-00:multi-export:src', rule: 'multi-export', folder: 'src', blocking: 1, outcome: 'resolved', rationale: [], advisoryOutcomes: [] },
			],
			// no size or crowding batch ran, so there is no sprawl line to draw
			overCap: undefined,
		});
	});

	test('a refactor run whose frozen work-list will not parse reports nothing to draw', async () => {
		const { cwd } = await setupRefactorRun({ worklist: '{ not json' });

		const view = await getRunView({ cwd, runId: 'run-refactor' });

		// unreadable state is skipped in silence, the way the runs list skips it
		expect(view.burnDown).toBe(undefined);
	});

	test('a refactor run whose plan does not name the work-list reports nothing, though the file is there', async () => {
		const { cwd } = await setupRefactorRun({ batches: [{ rule: 'size-file', blocking: 1 }], plan: 'plans/demo/plan.md' });

		const view = await getRunView({ cwd, runId: 'run-refactor' });

		// a readable work-list sits beside this run and is never opened: the
		// manifest's plan is what says the run has one
		expect(view.burnDown).toBe(undefined);
	});

	test('a coverage run keeps the earliest reading of every file and its latest, worst file first', async () => {
		const { cwd } = await setupCoverageRun({
			reports: [
				{
					outcome: 'resolved',
					rationale: [],
					files: [
						{ path: 'src/b.ts', beforePct: 20, afterPct: 60 },
						{ path: 'src/a.ts', beforePct: 10, afterPct: 40 },
					],
				},
				{
					outcome: 'resolved',
					rationale: [],
					files: [
						{ path: 'src/b.ts', beforePct: 60, afterPct: 90 },
						{ path: 'src/c.ts', beforePct: 30, afterPct: 40 },
					],
				},
			],
		});

		const view = await getRunView({ cwd, runId: 'run-coverage' });

		// b.ts was measured twice: it keeps the 20 it started at rather than the 60
		// the second batch inherited, and two files tied at 40 fall into path order
		expect(view.burnDown).toStrictEqual({
			batches: [],
			files: [
				{ path: 'src/a.ts', beforePct: 10, afterPct: 40 },
				{ path: 'src/c.ts', beforePct: 30, afterPct: 40 },
				{ path: 'src/b.ts', beforePct: 20, afterPct: 90 },
			],
		});
	});

	test('a coverage run that recorded no measurement reports nothing to draw', async () => {
		const { cwd } = await setupCoverageRun({ reports: [undefined, { outcome: 'resolved', rationale: [] }] });

		const view = await getRunView({ cwd, runId: 'run-coverage' });

		// a step with no report, and one whose report carries no file rows: neither
		// is a measurement, so there is no before and after to show
		expect(view.burnDown).toBe(undefined);
	});
});
