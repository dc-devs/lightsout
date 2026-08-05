import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunManifest } from '@/contracts';

const base = {
	runId: 'run-1',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	plan: 'plan.md',
	status: 'pending',
	currentStep: null,
	steps: [],
	changedFiles: [],
};

test('RunManifest: harness records the run\'s harness and is required', () => {
	const parsed = RunManifest.parse({ ...base, harness: 'codex' });

	assert.equal(parsed.harness, 'codex', 'the run record names the harness the run was started with — a resumed run must reuse it');
	assert.equal(RunManifest.safeParse(base).success, false, 'a manifest with no harness fails the read boundary — there is nothing to resume onto');
});

test('RunManifest: the old driver field is not accepted as a harness — an old manifest simply fails to parse', () => {
	const oldShape = RunManifest.safeParse({ ...base, driver: 'stub' });
	const both = RunManifest.parse({ ...base, harness: 'stub', driver: 'codex' });

	assert.equal(oldShape.success, false, 'no migration and no fallback: a pre-rename manifest fails the read boundary, the existing behavior for any incompatible manifest');
	assert.equal(both.harness, 'stub', 'a leftover driver key never overrides the renamed field');
	assert.equal('driver' in both, false, 'the removed name leaves no key on the parsed manifest');
});

test('RunManifest: packages and baselineDirtyFiles default to empty arrays when absent', () => {
	const parsed = RunManifest.parse({ ...base, harness: 'codex' });

	assert.deepEqual(parsed.packages, [], 'a manifest written before any scope was seeded reads back as unscoped, not undefined — non-monorepo runs never carry the key');
	assert.deepEqual(parsed.baselineDirtyFiles, [], 'an absent baseline means nothing was dirty at run start, so every git-reported change is attributed to the run');
});

test('RunManifest: packagesSource records where the initial scope came from, and only the three known origins parse', () => {
	for (const packagesSource of ['flag', 'front-matter', 'plan-paths']) {
		assert.equal(RunManifest.parse({ ...base, harness: 'codex', packagesSource }).packagesSource, packagesSource, `${packagesSource} is a recorded scope origin — a derived scope must never be mistaken for a declared one`);
	}

	assert.equal(RunManifest.safeParse({ ...base, harness: 'codex', packagesSource: 'derived' }).success, false, 'an unrecognized origin fails the read boundary rather than being recorded as an unknown provenance');
	assert.equal(RunManifest.safeParse({ ...base, harness: 'codex' }).success, true, 'the field stays optional — a run with no package scope has no origin to record');
});

test('RunManifest: steps are validated as step records — one malformed step fails the whole manifest', () => {
	const step = { id: 'implement', status: 'failed', attempts: 2, durationMs: 4200, changedFiles: ['src/a.ts'], error: 'gate check failed' };

	const parsed = RunManifest.parse({ ...base, harness: 'codex', steps: [step] });

	assert.deepEqual(parsed.steps, [step], 'each step round-trips whole — the manifest is the only state a resumed run reads');
	assert.equal(RunManifest.safeParse({ ...base, harness: 'codex', steps: [{ id: 'implement', status: 'running' }] }).success, false, 'a step missing its attempt count fails the manifest rather than resuming with an unknown retry position');
});

test('RunManifest: the run status is a closed set — every pausable state parses and an unknown one does not', () => {
	for (const status of ['pending', 'running', 'passed', 'failed', 'paused-rate-limit', 'paused-budget', 'escalated']) {
		assert.equal(RunManifest.parse({ ...base, harness: 'codex', status }).status, status, `${status} is a durable run state — the two paused ones are resumable, not errors`);
	}

	assert.equal(RunManifest.safeParse({ ...base, harness: 'codex', status: 'cancelled' }).success, false, 'an unrecognized run state fails the read boundary rather than resuming into a branch nothing handles');
});

test('RunManifest: the config snapshot and the usage aggregate are optional and survive parsing intact', () => {
	const config = { harness: 'codex', effort: 'high', scripts: { check: 'c', testUnit: 't', testCoverage: false } };
	const usage = { invocations: 7, inputTokens: 10, outputTokens: 100, cacheReadTokens: 880, cacheCreationTokens: 110, costUsd: 0.5 };

	const parsed = RunManifest.parse({ ...base, harness: 'codex', config, usage });

	assert.deepEqual(parsed.config, config, 'the snapshot is the permanent record of which settings produced this run — resume executes with the current file, this preserves what it started with');
	assert.deepEqual(parsed.usage, usage, 'the run-wide aggregate round-trips with its invocation count');
	assert.equal(RunManifest.safeParse({ ...base, harness: 'codex' }).success, true, 'both stay optional — a driver reporting no usage and a run predating the snapshot still parse');
});

test('RunManifest: an unparseable config snapshot fails the manifest', () => {
	const stale = { ...base, harness: 'codex', config: { driver: 'codex', scripts: { check: 'c', testUnit: 't', testCoverage: false } } };

	assert.equal(RunManifest.safeParse(stale).success, false, 'the snapshot is a real config, held to the same read boundary — a manifest cannot smuggle in a shape the config schema refuses');
});
