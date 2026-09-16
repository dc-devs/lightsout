import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { PlanningProgress } from '#src/contracts/index.ts';
import { PlanningStep, PlanningVocabulary, RunStatus } from '#src/contracts/index.ts';
import { commitPlanningSnapshot, planningStorePaths, planWorkspaceDir } from '#src/plan/index.ts';
import { getPlanningProgressPath, readPlanningProgress } from '#src/plan/progress/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { planningCanonicalDiagnosticsFixture } from '#tests/helpers/planningCanonicalDiagnosticsFixture.ts';
import { planningStoreFixture } from '#tests/helpers/planningStoreFixture.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

const validRecord: PlanningProgress = {
	name: 'valid',
	updatedAt: '2026-09-10T10:01:30.000Z',
	steps: [
		{
			step: PlanningStep.VerifyFacts,
			status: RunStatus.Passed,
			attempts: 2,
			pid: 4242,
			startedAt: '2026-09-10T10:00:00.000Z',
			finishedAt: '2026-09-10T10:00:30.000Z',
			durationMs: 30_000,
		},
		{
			step: PlanningStep.Draft,
			status: RunStatus.Running,
			attempts: 1,
			pid: 4242,
			startedAt: '2026-09-10T10:01:00.000Z',
		},
	],
};

/** A repo whose plan folders each hold one kind of planning record: valid, absent, not JSON, or off-contract. */
const setupPlanFolders = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-planning-progress-'));
	const bodies: Record<string, string | undefined> = {
		valid: JSON.stringify(validRecord),
		absent: undefined,
		unparseable: 'not json at all',
		'zero-attempts': JSON.stringify({
			name: 'zero-attempts',
			updatedAt: '2026-09-10T10:00:00.000Z',
			steps: [{ step: PlanningStep.Draft, status: RunStatus.Running, attempts: 0, pid: 4242, startedAt: '2026-09-10T10:00:00.000Z' }],
		}),
	};

	for (const [name, body] of Object.entries(bodies)) {
		mkdirSync(join(cwd, '.lightsout', 'plans', name), { recursive: true });

		if (body !== undefined) {
			writeFileSync(join(cwd, '.lightsout', 'plans', name, 'planning-progress.json'), body, 'utf8');
		}
	}

	return { cwd, names: Object.keys(bodies) };
};

/** A committed generation holding no work, no evidence, no recorded call and no implement run — every diagnostic this reader can offer is simply absent. */
const setupBareGeneration = async () => {
	const fixture = await planningStoreFixture({ name: 'bare-generation' });
	const committed = await commitPlanningSnapshot({ ...fixture, expectedRevision: -1, parentDigest: null });

	if (!committed.committed) throw new Error('The bare generation fixture lost its transaction');

	return fixture;
};

/**
 * The canonical diagnostics fixture with its first commit overwritten by
 * rubbish, and a legacy record beside it claiming every step passed — the exact
 * pair that must never answer "complete".
 */
const setupCorruptAuthority = async () => {
	const { cwd, name } = await planningCanonicalDiagnosticsFixture();
	const paths = await planningStorePaths({ cwd, name });

	await writeFile(join(paths.commits, '0000000000.json'), 'not a planning commit at all', 'utf8');
	await writeFile(
		getPlanningProgressPath({ cwd, name }),
		JSON.stringify({
			name,
			updatedAt: '2026-09-10T10:00:00.000Z',
			steps: Object.values(PlanningStep).map((step) => ({
				step,
				status: RunStatus.Passed,
				attempts: 1,
				pid: 4242,
				startedAt: '2026-09-10T10:00:00.000Z',
				finishedAt: '2026-09-10T10:00:30.000Z',
				durationMs: 30_000,
			})),
		}),
		'utf8',
	);

	return { cwd, name };
};

/**
 * The canonical diagnostics fixture with two more readable run directories
 * beside its own failed one: a later implement run of the same plan, and the
 * newest run in the repo, which belongs to a different plan entirely.
 *
 * The rival run is written last and dated latest on purpose — a reader that
 * took the newest manifest in the repo, or the first one it happened to read,
 * would answer with somebody else's run here.
 */
const setupRivalRuns = async () => {
	const { cwd, name } = await planningCanonicalDiagnosticsFixture();

	await seedRunDir({
		cwd,
		manifest: { runId: 'implement-later', status: RunStatus.Passed, plan: `.lightsout/plans/${name}/plan.md`, updatedAt: '2026-02-01T00:00:00.000Z' },
	});
	await seedRunDir({
		cwd,
		manifest: { runId: 'implement-other', status: RunStatus.Failed, plan: '.lightsout/plans/other-plan/plan.md', updatedAt: '2026-03-01T00:00:00.000Z' },
	});

	return { cwd, name };
};

/**
 * A committed generation whose only attempt stopped without a result, and two
 * different provider calls recorded behind it.
 *
 * Both calls reported a bill, and both carry the reply text the recorder writes
 * beside it — the text a diagnostic may never repeat back.
 */
const setupStoppedAttempt = async () => {
	const fixture = await planningStoreFixture({ name: 'stopped-attempt' });
	const { cwd, name, scope, origin, record } = fixture;

	record.work = [
		{
			id: 'stopped-author',
			role: PlanningVocabulary.Role.Investigate,
			stage: PlanningVocabulary.Stage.Implementation,
			scope,
			prerequisiteIds: [],
			inputDigest: origin.sha256,
			status: PlanningVocabulary.WorkState.Interrupted,
			attemptSequence: 3,
			failureIds: [],
			diagnosisIds: [],
			assignment: 'Investigate the upload contract',
		},
	];

	const committed = await commitPlanningSnapshot({ ...fixture, expectedRevision: -1, parentDigest: null });

	if (!committed.committed) throw new Error('The stopped attempt fixture lost its transaction');

	const paths = await planningStorePaths({ cwd, name });
	const calls = [
		{ callId: 'call-first', usage: { inputTokens: 1_200, outputTokens: 300, cacheReadTokens: 40, cacheCreationTokens: 10, costUsd: 0.25 } },
		{ callId: 'call-second', usage: { inputTokens: 300, outputTokens: 100, cacheReadTokens: 20, cacheCreationTokens: 10, costUsd: 0.5 } },
	];

	for (const call of calls) {
		await writeFile(join(paths.local, `${call.callId}.json`), JSON.stringify({ ...call, text: 'recorded planning reply' }), 'utf8');
	}

	return { cwd, name };
};

/**
 * The canonical diagnostics fixture with its local call directory removed.
 *
 * A generation restored from a portable export carries its commits and no local
 * call records at all, so the directory this reader looks in is simply not
 * there. That is an absent measurement, never a failed read.
 */
const setupGenerationWithoutCallDirectory = async () => {
	const { cwd, name } = await planningCanonicalDiagnosticsFixture();
	const paths = await planningStorePaths({ cwd, name });

	await rm(paths.local, { recursive: true, force: true });

	return { cwd, name };
};

describe('readPlanningProgress', () => {
	test('answers undefined for an absent, unparseable or off-contract record, and the parsed record otherwise', async () => {
		const { cwd, names } = setupPlanFolders();

		const readings = await Promise.all(names.map((name) => readPlanningProgress({ cwd, name })));

		expect(readings).toStrictEqual([validRecord, undefined, undefined, undefined]);
	});

	test('getPlanningProgressPath names planning-progress.json inside the plan folder', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-planning-progress-'));
		const planFolder = planWorkspaceDir({ cwd, name: 'demo' });

		const path = getPlanningProgressPath({ cwd, name: 'demo' });

		expect(path).toBe(join(planFolder, 'planning-progress.json'));
	});

	test('projects the canonical store — its work, its blockers and one bill per recorded call', async () => {
		const { cwd, name } = await planningCanonicalDiagnosticsFixture();

		const progress = await readPlanningProgress({ cwd, name });

		expectDefined(progress);
		expect(progress.steps).toStrictEqual([]);
		const canonical = progress.canonical;
		expectDefined(canonical);
		expect(canonical.work).toStrictEqual([
			expect.objectContaining({ id: 'author', role: 'investigate', status: RunStatus.Passed }),
			expect.objectContaining({ id: 'reviewer', role: 'implementation-review', status: RunStatus.Passed }),
			expect.objectContaining({ id: 'architect-recheck', role: 'architect', status: RunStatus.Pending, attempts: 0 }),
			expect.objectContaining({ id: 'repair-upload-contract', role: 'repair', status: RunStatus.Running, attempts: 2 }),
		]);
		expect(canonical.blockers).toStrictEqual([expect.stringContaining('contract-drift')]);
		expect(canonical.reuse).toStrictEqual({ savedConclusions: 1, repairedFindings: 1 });
		// the billed call is on disk twice, as a restored generation replays it — billing it twice would overstate what planning cost
		expect(canonical.usage).toStrictEqual({ calls: 2, unreported: 1, totals: expect.objectContaining({ costUsd: 0.25, inputTokens: 1_200 }) });
		expect(canonical.implementation).toStrictEqual({ runId: 'implement-demo', status: RunStatus.Failed });
	});

	test('leaves reuse, spend and implementation absent when the records hold none of them', async () => {
		const { cwd, name } = await setupBareGeneration();

		const progress = await readPlanningProgress({ cwd, name });

		expectDefined(progress);
		const canonical = progress.canonical;
		expectDefined(canonical);
		expect(canonical.work).toStrictEqual([]);
		expect(canonical.blockers).toStrictEqual([]);
		// absent rather than zeroed: nothing recorded a saved conclusion, a call or a run, and a zero would read as a measurement
		expect(canonical.reuse).toBeUndefined();
		expect(canonical.usage).toStrictEqual({ calls: 0, unreported: 0 });
		expect(canonical.implementation).toBeUndefined();
	});

	test('skips a call record and a run manifest it cannot read rather than guessing at them', async () => {
		const { cwd, name } = await planningCanonicalDiagnosticsFixture();
		const paths = await planningStorePaths({ cwd, name });
		const runDir = await seedRunDir({ cwd, manifest: { runId: 'implement-broken' } });

		await writeFile(join(paths.local, 'call-corrupt.json'), 'not a call record', 'utf8');
		await writeFile(join(runDir, 'manifest.json'), 'not a run manifest', 'utf8');
		const progress = await readPlanningProgress({ cwd, name });

		expectDefined(progress);
		const canonical = progress.canonical;
		expectDefined(canonical);
		// neither unreadable file is invented into a number: the call count and the
		// implement run are exactly what the readable records say
		expect(canonical.usage).toStrictEqual({ calls: 2, unreported: 1, totals: expect.objectContaining({ costUsd: 0.25 }) });
		expect(canonical.implementation).toStrictEqual({ runId: 'implement-demo', status: RunStatus.Failed });
	});

	test('names the latest implement run of this plan, and never a run that belongs to another', async () => {
		const { cwd, name } = await setupRivalRuns();

		const progress = await readPlanningProgress({ cwd, name });

		expectDefined(progress);
		const canonical = progress.canonical;
		expectDefined(canonical);
		// the later of this plan's two runs, and not the repo's newest run, which
		// is another plan's business
		expect(canonical.implementation).toStrictEqual({ runId: 'implement-later', status: RunStatus.Passed });
	});

	test('a canonical store that does not verify is unreadable, never the legacy record beside it', async () => {
		const { cwd, name } = await setupCorruptAuthority();

		const progress = await readPlanningProgress({ cwd, name });

		expect(progress).toBeUndefined();
	});
	test('draws an attempt that stopped without a result as failed, never as one still going or one that finished', async () => {
		const { cwd, name } = await setupStoppedAttempt();

		const progress = await readPlanningProgress({ cwd, name });

		expectDefined(progress);
		const canonical = progress.canonical;
		expectDefined(canonical);
		// the three attempts it already spent are carried through, so the row says
		// how much work stopped rather than only that something did
		expect(canonical.work).toStrictEqual([{ id: 'stopped-author', role: 'investigate', status: RunStatus.Failed, attempts: 3 }]);
	});

	test('a generation with no local call directory reports no calls rather than failing to read', async () => {
		const { cwd, name } = await setupGenerationWithoutCallDirectory();

		const progress = await readPlanningProgress({ cwd, name });

		expectDefined(progress);
		const canonical = progress.canonical;
		expectDefined(canonical);
		// the rest of the projection still answers: a missing call directory costs
		// the spend figure and nothing else
		expect(canonical.usage).toStrictEqual({ calls: 0, unreported: 0 });
		expect(canonical.blockers).toStrictEqual([expect.stringContaining('contract-drift')]);
		expect(canonical.implementation).toStrictEqual({ runId: 'implement-demo', status: RunStatus.Failed });
	});

	test('adds two different calls together, and carries none of the reply text recorded beside them', async () => {
		const { cwd, name } = await setupStoppedAttempt();

		const progress = await readPlanningProgress({ cwd, name });

		expectDefined(progress);
		const canonical = progress.canonical;
		expectDefined(canonical);
		// every recorded number summed, and nothing else: a reader that let the
		// harness's own reply through would be feeding model output back to a model
		expect(canonical.usage).toStrictEqual({
			calls: 2,
			unreported: 0,
			totals: { inputTokens: 1_500, outputTokens: 400, cacheReadTokens: 60, cacheCreationTokens: 20, costUsd: 0.75 },
		});
	});
});
