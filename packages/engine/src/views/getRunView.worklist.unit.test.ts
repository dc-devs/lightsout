import { describe, expect, test } from '@jest/globals';
import { PipelineKind, RunStatus, StandardsSeverity, type StepRecord } from '#src/contracts/index.ts';
import { getRunView } from '#src/views/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

/** One frozen batch, with as many blocking findings as the case asks for. */
const buildBatch = ({ id, rule, blocking }: { id: string; rule: string; blocking: number }) => ({
	id,
	rule,
	folder: 'packages/engine',
	blocking: Array.from({ length: blocking }, (_, index) => ({
		rule,
		severity: StandardsSeverity.Blocking,
		siteKey: `${id}:${index}`,
		files: [{ path: `packages/engine/src/${index}.ts` }],
		detail: 'a finding',
	})),
	advisories: [],
});

/**
 * One run on disk, named by its plan. A plan path ending in `worklist.json` is
 * what a refactor or coverage run records, and is what makes the run detail
 * open the frozen file at all.
 */
const setupRun = async ({
	pipeline,
	plan = '.lightsout/runs/run-worklist/worklist.json',
	worklist,
	steps = [],
}: {
	pipeline: PipelineKind;
	plan?: string;
	worklist?: string;
	steps?: StepRecord[];
}) => {
	const cwd = await freshCwd();

	await seedRunDir({ cwd, manifest: { runId: 'run-worklist', pipeline, plan, steps }, worklist });

	return { cwd };
};

describe('getRunView', () => {
	test('a refactor run reports the burn-down its frozen work-list makes possible, beside the title read from that same file', async () => {
		const batches = [
			buildBatch({ id: 'batch-01:multi-export:engine', rule: 'multi-export', blocking: 3 }),
			buildBatch({ id: 'batch-02:size-file:engine', rule: 'size-file', blocking: 2 }),
		];
		const { cwd } = await setupRun({
			pipeline: PipelineKind.Refactor,
			worklist: JSON.stringify({ at: '2026-01-01T00:00:00.000Z', path: '.', all: false, batches }),
			steps: [{ id: batches[0].id, status: RunStatus.Passed, attempts: 1, report: { outcome: 'resolved', remainingSiteKeys: [], rationale: [] } }],
		});

		const view = await getRunView({ cwd, runId: 'run-worklist' });

		// one open of worklist.json answers both: the row's title and the panel's
		// numbers come out of the same frozen file, so they cannot disagree
		expect(view.listing.title).toBe('refactor · multi-export, size-file');
		expect(view.burnDown).toEqual(expect.objectContaining({ before: 5, after: 2, batchesResolved: 1, batchesDeclined: 0 }));
		// the batch the run never reached left its sites exactly where they were
		expect(view.burnDown?.batches.map((batch) => batch.outcome)).toStrictEqual(['resolved', 'not-run']);
	});

	test('a refactor run whose frozen work-list will not parse still names its pipeline, and offers no burn-down', async () => {
		const { cwd } = await setupRun({ pipeline: PipelineKind.Refactor, worklist: '{ not json' });

		const view = await getRunView({ cwd, runId: 'run-worklist' });

		// unreadable state is skipped in silence rather than drawn as zeroes
		expect(view.listing.title).toBe('refactor');
		expect(view.burnDown).toBe(undefined);
	});

	test('a coverage run reports the files its batches measured, worst first', async () => {
		const { cwd } = await setupRun({
			pipeline: PipelineKind.Coverage,
			worklist: JSON.stringify({ at: '2026-01-01T00:00:00.000Z', totals: [], files: [] }),
			steps: [
				{
					id: 'batch-01:coverage',
					status: RunStatus.Passed,
					attempts: 1,
					report: {
						outcome: 'resolved',
						rationale: [],
						files: [
							{ path: 'src/a.ts', beforePct: 40, afterPct: 91 },
							{ path: 'src/b.ts', beforePct: 10, afterPct: 12 },
						],
					},
				},
			],
		});

		const view = await getRunView({ cwd, runId: 'run-worklist' });

		expect(view.burnDown?.files).toStrictEqual([
			{ path: 'src/b.ts', beforePct: 10, afterPct: 12 },
			{ path: 'src/a.ts', beforePct: 40, afterPct: 91 },
		]);
		// a coverage run counts files rather than sites, so it carries no batch rows
		expect(view.burnDown?.batches).toStrictEqual([]);
	});

	test('a run whose plan is an ordinary document is never asked for a work-list, and burns nothing down', async () => {
		const { cwd } = await setupRun({ pipeline: PipelineKind.Implement, plan: 'plans/add-search/plan.md' });

		const view = await getRunView({ cwd, runId: 'run-worklist' });

		expect(view.listing.title).toBe('add-search');
		expect(view.burnDown).toBe(undefined);
	});
});
