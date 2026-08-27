/**
 * @jest-environment node
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { RunStatus } from '@lightsout/engine/contracts';
import { getReader, type LightsoutReader } from '#src/lightsout/index.ts';

const runId = 'abcdef0123456789';

/** A run of this repo that finished, naming a phase file inside the workspace below — which is what makes that plan implemented. */
const manifestText = JSON.stringify({
	runId,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	plan: '.lightsout/plans/search-ranking/phase1-groundwork.md',
	harness: 'claude-code',
	status: RunStatus.Passed,
	currentStep: null,
	steps: [{ id: 'implement', status: RunStatus.Passed, attempts: 1 }],
	changedFiles: ['src/search/rank.ts'],
});

/** The grade report this arrangement writes, as text — what a test overriding it writes its own version of. */
const gradeText = JSON.stringify({ planName: 'search-ranking', grade: 'A', passed: true, gradedAt: '2026-01-02T00:00:00.000Z' });

/**
 * A phased plan that got the whole way: notes it started from, an overview and
 * two open phases, one phase already archived, both JSON records, a transcript,
 * a grade, and the passed run that implemented it.
 *
 * One workspace holding every kind of file the two methods bucket, so the list
 * row and the detail view are read from the same disk — a reader that handed
 * either method a different root could not answer both from it.
 */
const setupPlansReader = async ({ grade = gradeText }: { grade?: string } = {}): Promise<{ reader: LightsoutReader }> => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'lightsout-reader-plans-'));
	const workspace = '.lightsout/plans/search-ranking';
	const files: Record<string, string> = {
		[`.lightsout/runs/${runId}/manifest.json`]: manifestText,
		[`${workspace}/notes.md`]: '# Rough idea\n',
		[`${workspace}/overview.md`]: '# Search ranking\n',
		[`${workspace}/phase1-groundwork.md`]: '# Phase 1\n',
		[`${workspace}/phase2-ranking.md`]: '# Phase 2\n',
		[`${workspace}/implemented/phase0-spike.md`]: '# Phase 0\n',
		[`${workspace}/grade.json`]: grade,
		[`${workspace}/facts.json`]: JSON.stringify({
			request: 'Rank search results by recency',
			verification: { pathsChecked: 4, scriptsChecked: 2 },
			verifiedAt: '2026-01-02T00:00:00.000Z',
		}),
		[`${workspace}/decisions.json`]: JSON.stringify({
			planName: 'search-ranking',
			decisions: [
				{
					source: 'Converge',
					question: 'how runs are matched',
					options: 'exact / prefix',
					choice: 'prefix match',
					rationale: 'a phase file is not the plan path',
				},
			],
		}),
		[`${workspace}/draft-stream.jsonl`]: '{"type":"turn"}\n',
	};

	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(repoRoot, path)), { recursive: true });
		await writeFile(join(repoRoot, path), content, 'utf8');
	}

	process.env.LIGHTSOUT_REPO = repoRoot;

	return { reader: getReader() };
};

/**
 * A repo of somebody's own that nobody has planned in: its `.lightsout/` is
 * there and no plans folder was ever created.
 *
 * A second arrangement rather than a parameter, because what it arranges is a
 * missing folder rather than an empty one — the case the health tile's count
 * reads on a fresh clone.
 */
const setupUnplannedRepo = async (): Promise<{ reader: LightsoutReader }> => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'lightsout-reader-unplanned-'));

	await mkdir(join(repoRoot, '.lightsout'), { recursive: true });

	process.env.LIGHTSOUT_REPO = repoRoot;

	return { reader: getReader() };
};

afterEach(() => {
	delete process.env.LIGHTSOUT_REPO;
});

describe('getReader plans', () => {
	test('hands back the whole plans row unreshaped — every field the table, the health tile and the command cards read', async () => {
		const { reader } = await setupPlansReader();

		const listings = await reader.listPlanWorkspaces();

		expect(listings).toEqual([
			{
				name: 'search-ranking',
				stage: 'implemented',
				grade: 'A',
				hasNotes: true,
				hasPlanFile: true,
				phased: true,
				phaseCount: 2,
				runCount: 1,
				implementedFiles: [expect.objectContaining({ name: 'implemented/phase0-spike.md' })],
				updatedAt: expect.any(String),
			},
		]);
	});

	test('lists nothing for a repo nobody has planned in, rather than failing the page that counts open plans', async () => {
		const { reader } = await setupUnplannedRepo();

		const listings = await reader.listPlanWorkspaces();

		expect(listings).toStrictEqual([]);
	});

	test('returns one workspace with its records parsed and its transcripts named rather than read', async () => {
		const { reader } = await setupPlansReader();

		const workspace = await reader.getPlanWorkspace({ name: 'search-ranking' });

		expect({
			request: workspace.facts?.request,
			choices: workspace.decisions?.decisions.map((row) => row.choice),
			grade: workspace.grade?.grade,
			transcripts: workspace.transcripts.map((file) => file.name),
			runs: workspace.runs.map((run) => run.runId),
			problems: workspace.problems,
		}).toStrictEqual({
			request: 'Rank search results by recency',
			choices: ['prefix match'],
			grade: 'A',
			transcripts: ['draft-stream.jsonl'],
			runs: [runId],
			problems: [],
		});
	});

	test('rejects a plan name no folder answers to rather than resolving to an empty workspace', async () => {
		const { reader } = await setupPlansReader();

		await expect(reader.getPlanWorkspace({ name: 'never-planned' })).rejects.toThrow(/never-planned/);
	});

	test('reports a record that will not parse as a line the page can show, rather than refusing the whole workspace', async () => {
		const { reader } = await setupPlansReader({ grade: '{ not json at all' });

		const workspace = await reader.getPlanWorkspace({ name: 'search-ranking' });

		expect({ grade: workspace.grade, problems: workspace.problems }).toEqual({ grade: undefined, problems: [expect.stringContaining('grade.json')] });
	});
});
