import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readPlanActivityReports } from '#src/views/readPlanActivityReports.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';

// No module mocks: the reader's whole job is a record file inside a plan folder,
// so each case writes real records into a real plans directory and reads them
// back off disk.

/** The one process every case prices its totals from: two minutes, tokens and a stated cost. */
const harnessProcess = ({ levelId }: { levelId: string }) => ({
	kind: 'harness-process',
	levelId,
	harness: 'claude',
	model: 'claude-opus-5',
	effort: 'high',
	spawn: 1,
	reemit: false,
	startedAt: '2026-09-17T08:00:10.000Z',
	endedAt: '2026-09-17T08:02:10.000Z',
	endReason: 'completed',
	usage: { inputTokens: 1200, outputTokens: 340, costUsd: 0.5 },
});

/**
 * A finished record: a plan level running three minutes, one step level inside
 * it, and one harness process of two minutes inside that.
 */
const completeLines = ({ plan }: { plan: string }) =>
	[
		{ kind: 'level-start', id: `${plan}:plan`, level: 'plan', label: plan, at: '2026-09-17T08:00:00.000Z' },
		{ kind: 'level-start', id: `${plan}:draft`, parentId: `${plan}:plan`, level: 'step', label: 'draft', at: '2026-09-17T08:00:00.000Z' },
		harnessProcess({ levelId: `${plan}:draft` }),
		{ kind: 'level-end', id: `${plan}:draft`, at: '2026-09-17T08:02:20.000Z', outcome: 'passed' },
		{ kind: 'level-end', id: `${plan}:plan`, at: '2026-09-17T08:03:00.000Z', outcome: 'passed' },
	].map((mark) => JSON.stringify(mark));

interface SetupParams {
	/** One entry per plan folder: its record's raw contents, or `undefined` for a folder holding no record at all. */
	records: Record<string, string | undefined>;
}

const setupPlanRecords = async ({ records }: SetupParams) => {
	const cwd = await freshCwd();

	for (const [name, contents] of Object.entries(records)) {
		const dir = planWorkspaceFolder({ cwd: cwd, name: name });

		await mkdir(dir, { recursive: true });

		if (contents !== undefined) {
			// written verbatim, so a cut-off final line stays cut off
			await writeFile(join(dir, 'activity.jsonl'), contents, 'utf8');
		}
	}

	return { cwd };
};

describe('readPlanActivityReports', () => {
	test("readPlanActivityReports: reads each named plan's tree and reports an absent record as an absent tree", async () => {
		const { cwd } = await setupPlanRecords({
			records: {
				'lo-150-observability/001-record': `${completeLines({ plan: 'lo-150-observability/001-record' }).join('\n')}\n`,
				// a plan folder drafted before the record existed has no record at all
				'lo-150-observability/002-silent': undefined,
			},
		});

		const reports = await readPlanActivityReports({ cwd, names: ['lo-150-observability/001-record', 'lo-150-observability/002-silent'] });

		// one entry per name in the given order: a plan with nothing recorded is an
		// absent tree rather than a read that failed for the plan beside it
		expect(reports).toEqual([
			{
				name: 'lo-150-observability/001-record',
				report: expect.objectContaining({
					plan: 'lo-150-observability/001-record',
					roots: [
						expect.objectContaining({
							level: 'plan',
							label: 'lo-150-observability/001-record',
							children: [expect.objectContaining({ level: 'step', label: 'draft' })],
						}),
					],
					totals: expect.objectContaining({
						wallMs: 180_000,
						agentMs: 120_000,
						busyMs: 120_000,
						idleMs: 60_000,
						peakProcesses: 1,
						processCount: 1,
						usage: { inputTokens: 1200, outputTokens: 340, costUsd: 0.5 },
					}),
				}),
			},
			{ name: 'lo-150-observability/002-silent', report: undefined },
		]);
	});

	test('readPlanActivityReports: a record with unreadable lines still answers a tree from the marks that parsed', async () => {
		const lines = completeLines({ plan: 'lo-150-observability/003-partial' });
		const { cwd } = await setupPlanRecords({
			records: {
				'lo-150-observability/003-partial': [
					...lines.slice(0, 2),
					'{ not json',
					// a process line missing its spawn number: five minutes of agent time
					// that must not reach the totals, because the line never parsed
					JSON.stringify({
						kind: 'harness-process',
						levelId: 'lo-150-observability/003-partial:draft',
						harness: 'claude',
						reemit: false,
						startedAt: '2026-09-17T08:00:00.000Z',
						endedAt: '2026-09-17T08:05:00.000Z',
						endReason: 'completed',
					}),
					...lines.slice(2),
					'{"kind":"level-end","id":"lo-150-observ',
				].join('\n'),
			},
		});

		const reports = await readPlanActivityReports({ cwd, names: ['lo-150-observability/003-partial'] });

		// a partly written record still reports what it proved: the readable marks
		// build the tree, and the unreadable ones add no time and no spend
		expect(reports).toEqual([
			{
				name: 'lo-150-observability/003-partial',
				report: expect.objectContaining({
					plan: 'lo-150-observability/003-partial',
					roots: [expect.objectContaining({ level: 'plan', label: 'lo-150-observability/003-partial' })],
					totals: expect.objectContaining({
						wallMs: 180_000,
						agentMs: 120_000,
						processCount: 1,
						usage: { inputTokens: 1200, outputTokens: 340, costUsd: 0.5 },
					}),
				}),
			},
		]);
	});

	test('readPlanActivityReports: a record whose every line is unreadable answers an absent tree, never an empty one', async () => {
		const { cwd } = await setupPlanRecords({
			records: {
				// a record written by a process killed before its first mark completed:
				// the file is there, and not one line of it parses
				'lo-150-observability/004-garbage': '{ not json\n{"kind":"level-start","id":"lo-150-obs\n',
			},
		});

		const reports = await readPlanActivityReports({ cwd, names: ['lo-150-observability/004-garbage'] });

		// nothing parsed is nothing proved: the entry reports an absent tree, the
		// same answer a folder holding no record at all gives, rather than a tree
		// of zeroes a reader would take for a plan that ran and spent nothing
		expect(reports).toEqual([{ name: 'lo-150-observability/004-garbage', report: undefined }]);
	});
});
