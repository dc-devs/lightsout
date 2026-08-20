import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { RunStatus } from '#src/contracts/index.ts';
import { listRuns } from '#src/views/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

/** A frozen refactor work-list naming the rules its batches burn down. */
const refactorWorklist = ({ rules }: { rules: string[] }) =>
	JSON.stringify({
		at: '2026-01-01T00:00:00.000Z',
		path: '.',
		all: false,
		batches: rules.map((rule, index) => ({ id: `batch-0${index}:${rule}:src`, rule, folder: 'src', blocking: [], advisories: [] })),
	});

const coverageWorklist = () => JSON.stringify({ at: '2026-01-01T00:00:00.000Z', totals: [], files: [] });

test('a repo with no runs at all lists nothing rather than failing', async () => {
	expect(await listRuns({ cwd: await freshCwd() })).toStrictEqual([]);
});

test('runs come back newest first, whatever order they sit in on disk', async () => {
	const cwd = await freshCwd();

	await seedRunDir({ cwd, manifest: { runId: 'aaa-oldest', updatedAt: '2026-01-01T00:00:00.000Z' } });
	await seedRunDir({ cwd, manifest: { runId: 'zzz-newest', updatedAt: '2026-03-01T00:00:00.000Z' } });
	await seedRunDir({ cwd, manifest: { runId: 'mmm-middle', updatedAt: '2026-02-01T00:00:00.000Z' } });

	// the list is a history, so the run somebody is most likely looking for is first
	expect((await listRuns({ cwd })).map((run) => run.runId)).toStrictEqual(['zzz-newest', 'mmm-middle', 'aaa-oldest']);
});

test('a run directory that will not read is skipped, and the rest of the list survives it', async () => {
	const cwd = await freshCwd();

	await seedRunDir({ cwd, manifest: { runId: 'run-good' } });
	await seedRunDir({ cwd, manifest: { runId: 'run-broken' } });
	await writeFile(join(cwd, '.lightsout', 'runs', 'run-broken', 'manifest.json'), '{ not json', 'utf8');

	// one corrupt directory must not take the whole list down with it
	expect((await listRuns({ cwd })).map((run) => run.runId)).toStrictEqual(['run-good']);
});

test('a listing row folds the manifest into what a list needs, with no JSONL file opened', async () => {
	const cwd = await freshCwd();

	await seedRunDir({
		cwd,
		manifest: {
			runId: 'abcdef0123456789',
			plan: 'plans/add-search/phase2-indexing.md',
			packages: ['engine'],
			changedFiles: ['src/a.ts', 'src/b.ts'],
			usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: 1.25, invocations: 2 },
			steps: [
				{ id: 'implement', status: RunStatus.Passed, attempts: 1 },
				{ id: 'write-tests', status: RunStatus.Failed, attempts: 2 },
			],
			status: RunStatus.Failed,
		},
	});

	const [run] = await listRuns({ cwd });

	expect(run).toStrictEqual({
		runId: 'abcdef0123456789',
		// the form every lightsout report prints and `resume --run` accepts
		shortId: 'abcdef01',
		// a manifest predating the discriminator reads as the pipeline that predates it
		pipeline: 'implement',
		status: RunStatus.Failed,
		// a numbered phase file names its plan folder as well as itself
		title: 'add-search · phase2-indexing',
		plan: 'plans/add-search/phase2-indexing.md',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		live: false,
		packages: ['engine'],
		stepsPassed: 1,
		stepCount: 2,
		changedFileCount: 2,
		costUsd: 1.25,
		// a failed run is work a resume would pick up
		resumable: true,
	});
});

test('a plan path names the run: a folder plan by its folder, anything else by its own name', async () => {
	const cwd = await freshCwd();

	await seedRunDir({ cwd, manifest: { runId: 'run-a', plan: 'plans/add-search/plan.md', updatedAt: '2026-01-03T00:00:00.000Z' } });
	await seedRunDir({ cwd, manifest: { runId: 'run-b', plan: 'plans/add-search/overview.md', updatedAt: '2026-01-02T00:00:00.000Z' } });
	await seedRunDir({ cwd, manifest: { runId: 'run-c', plan: 'plans/tighten-gates.md', updatedAt: '2026-01-01T00:00:00.000Z' } });

	// plan.md and overview.md name nothing on their own — the folder is the plan
	expect((await listRuns({ cwd })).map((run) => run.title)).toStrictEqual(['add-search', 'add-search', 'tighten-gates']);
});

test('a refactor run is titled by the rules its frozen work-list burns down, capped so a row stays a label', async () => {
	const cwd = await freshCwd();

	await seedRunDir({
		cwd,
		manifest: { runId: 'run-few', pipeline: 'refactor', plan: '.lightsout/runs/run-few/worklist.json', updatedAt: '2026-01-02T00:00:00.000Z' },
		worklist: refactorWorklist({ rules: ['multi-export', 'size-file', 'multi-export'] }),
	});
	await seedRunDir({
		cwd,
		manifest: { runId: 'run-many', pipeline: 'refactor', plan: '.lightsout/runs/run-many/worklist.json', updatedAt: '2026-01-01T00:00:00.000Z' },
		worklist: refactorWorklist({ rules: ['a-rule', 'b-rule', 'c-rule', 'd-rule', 'e-rule'] }),
	});

	// distinct rules in first-seen order; past three the rest become a count
	expect((await listRuns({ cwd })).map((run) => run.title)).toStrictEqual(['refactor · multi-export, size-file', 'refactor · a-rule, b-rule, c-rule +2 more']);
});

test('a work-list run keeps the kind its manifest recorded even when the file itself is unreadable', async () => {
	const cwd = await freshCwd();

	await seedRunDir({
		cwd,
		manifest: { runId: 'run-cov', pipeline: 'coverage', plan: '.lightsout/runs/run-cov/worklist.json', updatedAt: '2026-01-04T00:00:00.000Z' },
		worklist: coverageWorklist(),
	});
	await seedRunDir({
		cwd,
		manifest: { runId: 'run-cov-broken', pipeline: 'coverage', plan: '.lightsout/runs/run-cov-broken/worklist.json', updatedAt: '2026-01-03T00:00:00.000Z' },
		worklist: '{ not json',
	});
	await seedRunDir({
		cwd,
		manifest: { runId: 'run-ref-broken', pipeline: 'refactor', plan: '.lightsout/runs/run-ref-broken/worklist.json', updatedAt: '2026-01-02T00:00:00.000Z' },
		worklist: '{ "at": "nope" }',
	});
	// a work-list path on a manifest predating the discriminator
	await seedRunDir({ cwd, manifest: { runId: 'run-legacy', plan: '.lightsout/runs/run-legacy/worklist.json', updatedAt: '2026-01-01T00:00:00.000Z' } });

	// a coverage title carries no count — the frozen measurement has no threshold
	// to count against — and a corrupt file never reads as the other pipeline
	expect((await listRuns({ cwd })).map((run) => run.title)).toStrictEqual(['coverage', 'coverage', 'refactor', 'refactor']);
});

test('live is true only for the run the repo lock actually names', async () => {
	const cwd = await freshCwd();

	await seedRunDir({ cwd, manifest: { runId: 'run-live', status: RunStatus.Running, updatedAt: '2026-01-02T00:00:00.000Z' } });
	await seedRunDir({ cwd, manifest: { runId: 'run-zombie', status: RunStatus.Running, updatedAt: '2026-01-01T00:00:00.000Z' } });
	await writeFile(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ pid: process.pid, runId: 'run-live', startedAt: '2026-01-01T00:00:00.000Z' }), 'utf8');

	const runs = await listRuns({ cwd });

	expect(runs.map((run) => ({ id: run.runId, live: run.live, resumable: run.resumable }))).toStrictEqual([
		{ id: 'run-live', live: true, resumable: false },
		// a `running` manifest with nothing behind it is a crash leftover — resumable, not lost
		{ id: 'run-zombie', live: false, resumable: true },
	]);
});
