import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { RunStatus } from '#src/contracts/index.ts';
import { RunNotFoundError } from '#src/runState/index.ts';
import { getRunView } from '#src/views/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

const usage = { inputTokens: 10, outputTokens: 100, cacheReadTokens: 880, cacheCreationTokens: 110, costUsd: 0.5 };

const agentLine = ({ step, at = '2026-01-01T00:00:00.000Z' }: { step: string; at?: string }) =>
	`${JSON.stringify({ at, step, model: 'opus', effort: 'high', ...usage })}\n`;

/** A frozen refactor work-list that parses, so a reader ignoring it is a choice rather than a failure. */
const worklistNaming = ({ rules }: { rules: string[] }) =>
	JSON.stringify({
		at: '2026-01-01T00:00:00.000Z',
		path: '.',
		all: false,
		batches: rules.map((rule, index) => ({ id: `batch-0${index}:${rule}:src`, rule, folder: 'src', blocking: [], advisories: [] })),
	});

const commandLine = ({ kind, step, ...rest }: { kind: string; step?: string; rerun?: boolean; skipped?: true }) =>
	`${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', kind, group: 'root', command: 'pnpm check', exitCode: 0, durationMs: 1200, step, ...rest })}\n`;

test('a run with no evidence files at all still assembles, with empty logs rather than a failure', async () => {
	const cwd = await freshCwd();

	await seedRunDir({ cwd, manifest: { runId: 'run-bare' } });

	const view = await getRunView({ cwd, runId: 'run-bare' });

	expect(view.gates).toStrictEqual([]);
	expect(view.agents).toStrictEqual([]);
	expect(view.friction).toStrictEqual([]);
	expect(view.gateTotals).toStrictEqual({ commands: 0, reruns: 0, skipped: 0 });
	// the listing row is the same one the sidebar shows, assembled by the same helper
	expect(view.listing.title).toBe('demo');
	expect(view.harness).toBe('claude-code');
});

test('gate and agent lines are validated at the boundary, and a malformed line is skipped', async () => {
	const cwd = await freshCwd();

	await seedRunDir({
		cwd,
		manifest: { runId: 'run-logs', steps: [{ id: 'implement', status: RunStatus.Passed, attempts: 1, durationMs: 900 }] },
		logs: {
			agents: `${agentLine({ step: 'implement' })}{ not json\n${JSON.stringify({ at: 'x', step: 'implement' })}\n${agentLine({ step: 'implement-supervisor' })}`,
			commands: `${commandLine({ kind: 'check', step: 'implement' })}${commandLine({ kind: 'test', step: 'implement', rerun: true })}${commandLine({ kind: 'build', skipped: true })}{ not json\n`,
		},
	});

	const view = await getRunView({ cwd, runId: 'run-logs' });

	// two well-formed invocations survive; the unparseable line and the one
	// missing its usage fields are skipped, never guessed at
	expect(view.agents.map((entry) => entry.step)).toStrictEqual(['implement', 'implement-supervisor']);
	expect(view.agents[0]?.effort).toBe('high');
	expect(view.gates.map((gate) => gate.kind)).toStrictEqual(['check', 'test', 'build']);
	// a record written outside a step carries no step
	expect(view.gates[2]?.step).toBe(undefined);
	expect(view.gateTotals).toStrictEqual({ commands: 2, reruns: 1, skipped: 1 });
	// a supervisor consultation is spend on the step it supervised
	expect(view.steps[0]).toStrictEqual({
		id: 'implement',
		status: RunStatus.Passed,
		attempts: 1,
		durationMs: 900,
		changedFiles: [],
		error: undefined,
		invocations: 2,
		outputTokens: 200,
		costUsd: 1,
		report: undefined,
		// the phase links belong to a coordinator's steps, and this is not one
		planPath: undefined,
		childRunId: undefined,
	});
	expect(view.gateMs).toBe(3600);
});

test('a step no agent invocation was attributed to reports zero spend rather than nothing', async () => {
	const cwd = await freshCwd();

	await seedRunDir({
		cwd,
		manifest: { runId: 'run-quiet', steps: [{ id: 'format', status: RunStatus.Passed, attempts: 1 }] },
		logs: { agents: agentLine({ step: 'implement' }) },
	});

	const view = await getRunView({ cwd, runId: 'run-quiet' });

	// a gate-only step costs nothing, which is a number rather than an absence
	expect(view.steps[0]).toMatchObject({ id: 'format', invocations: 0, outputTokens: 0, costUsd: 0 });
});

test("a step's own record reaches the view whole: the files it touched, the error it failed with, and its report", async () => {
	const cwd = await freshCwd();

	await seedRunDir({
		cwd,
		manifest: {
			runId: 'run-failed-step',
			status: RunStatus.Failed,
			steps: [
				{
					id: 'write-tests',
					status: RunStatus.Failed,
					attempts: 2,
					durationMs: 450,
					changedFiles: ['src/a.unit.test.ts', 'src/b.unit.test.ts'],
					error: 'coverage threshold not met',
					report: { status: 'failed', failures: ['threshold'] },
				},
			],
		},
	});

	const view = await getRunView({ cwd, runId: 'run-failed-step' });

	// the report stays opaque here — the manifest's own bytes, not a reshaped copy
	expect(view.steps[0]).toStrictEqual({
		id: 'write-tests',
		status: RunStatus.Failed,
		attempts: 2,
		durationMs: 450,
		changedFiles: ['src/a.unit.test.ts', 'src/b.unit.test.ts'],
		error: 'coverage threshold not met',
		invocations: 0,
		outputTokens: 0,
		costUsd: 0,
		report: { status: 'failed', failures: ['threshold'] },
		planPath: undefined,
		childRunId: undefined,
	});
});

test('friction is narrowed to this run — the log is repo-wide', async () => {
	const cwd = await freshCwd();

	await seedRunDir({ cwd, manifest: { runId: 'run-mine' } });
	await seedRunDir({ cwd, manifest: { runId: 'run-theirs' } });
	await writeFile(
		join(cwd, '.lightsout', 'friction.jsonl'),
		`${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', runId: 'run-mine', step: 'implement', kind: 'friction', area: 'plan', detail: 'ambiguous' })}\n${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', runId: 'run-theirs', step: 'implement', kind: 'decision', area: 'prompt', detail: 'guessed' })}\n`,
		'utf8',
	);

	const view = await getRunView({ cwd, runId: 'run-mine' });

	// the whole records, not counts — a detail page shows each entry's text
	expect(view.friction).toStrictEqual([
		{ at: '2026-01-01T00:00:00.000Z', runId: 'run-mine', step: 'implement', kind: 'friction', area: 'plan', detail: 'ambiguous' },
	]);
});

test('the eight-character id a report printed resolves to the run it names', async () => {
	const cwd = await freshCwd();

	await seedRunDir({ cwd, manifest: { runId: 'abcdef0123456789' } });

	expect((await getRunView({ cwd, runId: 'abcdef01' })).listing.runId).toBe('abcdef0123456789');
});

test('an id no run answers to rejects as a mistaken id, not a missing file', async () => {
	const cwd = await freshCwd();

	await seedRunDir({ cwd, manifest: { runId: 'run-real' } });

	const error = await getRejectionError({ promise: getRunView({ cwd, runId: 'run-imaginary' }) });

	expect(error).toBeInstanceOf(RunNotFoundError);
});

test("a coordinator's steps name the phase file each implemented and the child run that did it", async () => {
	const cwd = await freshCwd();

	await mkdir(join(cwd, 'plans', 'add-search'), { recursive: true });
	await writeFile(join(cwd, 'plans', 'add-search', 'phase1.md'), '# Phase 1\n', 'utf8');
	await seedRunDir({
		cwd,
		manifest: {
			runId: 'run-coordinator',
			pipeline: 'phases',
			plan: 'plans/add-search/overview.md',
			status: RunStatus.Running,
			currentStep: 'phase2.md',
			// Step ids are the phase FILE names, extension included — what
			// initializeSequence records for every real phased run.
			steps: [
				{ id: 'phase1.md', status: RunStatus.Passed, attempts: 1, report: { runId: 'run-child' } },
				{ id: 'phase2.md', status: RunStatus.Running, attempts: 1 },
			],
		},
	});
	await seedRunDir({ cwd, manifest: { runId: 'run-child', overview: 'plans/add-search/overview.md', plan: 'plans/add-search/phase1.md' } });

	const view = await getRunView({ cwd, runId: 'run-coordinator' });

	// a coordinator's manifest carries no `overview` field; its own plan IS the overview
	expect(view.overview).toBe('plans/add-search/overview.md');
	expect(view.currentStep).toBe('phase2.md');
	// a step whose phase file is on disk names it; one whose file is not stays silent
	expect(view.steps.map((step) => ({ id: step.id, planPath: step.planPath, childRunId: step.childRunId }))).toStrictEqual([
		{ id: 'phase1.md', planPath: 'plans/add-search/phase1.md', childRunId: 'run-child' },
		{ id: 'phase2.md', planPath: undefined, childRunId: undefined },
	]);
	// nothing spawned the coordinator
	expect(view.parent).toBe(undefined);
});

test('a coordinator that recorded an overview of its own is read by that, not by its plan path', async () => {
	const cwd = await freshCwd();

	await seedRunDir({
		cwd,
		manifest: {
			runId: 'run-recorded-overview',
			pipeline: 'phases',
			plan: 'plans/add-search/overview.md',
			overview: 'plans/moved/overview.md',
			steps: [{ id: 'phase1.md', status: RunStatus.Pending, attempts: 0 }],
		},
	});

	const view = await getRunView({ cwd, runId: 'run-recorded-overview' });

	// a recorded overview outranks the fallback, so a coordinator whose plan path
	// is not the overview still reports the document its phases were cut from
	expect(view.overview).toBe('plans/moved/overview.md');
});

test('a phase run names the coordinator its own manifest records, and the step it served', async () => {
	const cwd = await freshCwd();

	await seedRunDir({
		cwd,
		manifest: {
			runId: 'run-coordinator',
			pipeline: 'phases',
			plan: 'plans/add-search/overview.md',
			steps: [{ id: 'phase1', status: RunStatus.Passed, attempts: 1, report: { runId: 'run-child' } }],
		},
	});
	// a sequence that named some other run is never opened at all: the link is a
	// field on this run, not something reconstructed from the rest of the history
	await seedRunDir({
		cwd,
		manifest: {
			runId: 'run-other-sequence',
			pipeline: 'phases',
			plan: 'plans/other/overview.md',
			steps: [{ id: 'phase1', status: RunStatus.Passed, attempts: 1, report: { runId: 'run-child' } }],
		},
	});
	await seedRunDir({
		cwd,
		manifest: {
			runId: 'run-child',
			overview: 'plans/add-search/overview.md',
			plan: 'plans/add-search/phase1.md',
			parentRunId: 'run-coordinator',
		},
	});

	const view = await getRunView({ cwd, runId: 'run-child' });

	// a back-link a reader can follow, titled the way the runs table titles it
	expect(view.parent).toStrictEqual({ runId: 'run-coordinator', step: 'phase1', title: 'add-search' });
	// a child run records its overview outright
	expect(view.overview).toBe('plans/add-search/overview.md');
});

test('a phase still in flight is named by the step the coordinator has open, since no report names it yet', async () => {
	const cwd = await freshCwd();

	await seedRunDir({
		cwd,
		manifest: {
			runId: 'run-coordinator',
			pipeline: 'phases',
			plan: 'plans/add-search/overview.md',
			currentStep: 'phase2',
			steps: [{ id: 'phase2', status: RunStatus.Running, attempts: 1 }],
		},
	});
	await seedRunDir({ cwd, manifest: { runId: 'run-child', plan: 'plans/add-search/phase2.md', parentRunId: 'run-coordinator' } });

	expect((await getRunView({ cwd, runId: 'run-child' })).parent).toStrictEqual({
		runId: 'run-coordinator',
		step: 'phase2',
		title: 'add-search',
	});
});

test('a run recording no coordinator, and one whose coordinator will not read, both go without a back-link', async () => {
	const cwd = await freshCwd();

	await seedRunDir({ cwd, manifest: { runId: 'bbb-broken' } });
	await writeFile(join(cwd, '.lightsout', 'runs', 'bbb-broken', 'manifest.json'), '{ not json', 'utf8');
	await seedRunDir({ cwd, manifest: { runId: 'ccc-orphan' } });
	await seedRunDir({ cwd, manifest: { runId: 'ddd-dangling', parentRunId: 'bbb-broken' } });

	// a top-level run, and a phase child whose coordinator is corrupt or gone —
	// neither is a page failure, both are simply a run with no parent to name
	expect((await getRunView({ cwd, runId: 'ccc-orphan' })).parent).toBe(undefined);
	expect((await getRunView({ cwd, runId: 'ddd-dangling' })).parent).toBe(undefined);
});

test('a back-link is titled from the coordinator manifest alone, so a work-list plan reads as the pipeline that froze it', async () => {
	const cwd = await freshCwd();

	await seedRunDir({
		cwd,
		manifest: {
			runId: 'run-sequence',
			pipeline: 'phases',
			plan: '.lightsout/runs/run-sequence/worklist.json',
			steps: [{ id: 'phase1', status: RunStatus.Passed, attempts: 1, report: { runId: 'run-child' } }],
		},
		worklist: worklistNaming({ rules: ['multi-export', 'size-file'] }),
	});
	await seedRunDir({ cwd, manifest: { runId: 'run-child', parentRunId: 'run-sequence' } });

	const view = await getRunView({ cwd, runId: 'run-child' });

	// the back-link reads the coordinator's manifest only — the readable work-list
	// beside it is never opened, so the label is the plain pipeline name rather
	// than the rules that file names
	expect(view.parent).toStrictEqual({ runId: 'run-sequence', step: 'phase1', title: 'refactor' });
});

test('a run reports the files it changed and the ones nothing public reached', async () => {
	const cwd = await freshCwd();

	await seedRunDir({
		cwd,
		manifest: {
			runId: 'run-files',
			changedFiles: ['src/a.ts', 'src/b.ts'],
			unreachableChangedFiles: ['src/b.ts'],
			usage: { ...usage, invocations: 3 },
		},
	});

	const view = await getRunView({ cwd, runId: 'run-files' });

	expect(view.changedFiles).toStrictEqual(['src/a.ts', 'src/b.ts']);
	expect(view.unreachableChangedFiles).toStrictEqual(['src/b.ts']);
	expect(view.usage?.invocations).toBe(3);
	// the share of input the model read from cache, out of everything readable
	expect(view.cacheReadShare).toBe(880 / 1000);
	expect(view.listing.costUsd).toBe(0.5);
});

test('a coordinator that has not yet opened a step for this child leaves the back-link off rather than naming nothing', async () => {
	const cwd = await freshCwd();

	// a sequence that has recorded no report for this run and has no step open —
	// there is no honest step to name, so the link waits rather than guessing
	await seedRunDir({ cwd, manifest: { runId: 'run-sequence', pipeline: 'phases', plan: 'plans/add-search/overview.md' } });
	await seedRunDir({ cwd, manifest: { runId: 'run-child', plan: 'plans/add-search/phase1.md', parentRunId: 'run-sequence' } });

	expect((await getRunView({ cwd, runId: 'run-child' })).parent).toBe(undefined);
});
