import { expect, test } from '@jest/globals';
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

test("RunManifest: harness records the run's harness and is required", () => {
	const parsed = RunManifest.parse({ ...base, harness: 'codex' });

	// the run record names the harness the run was started with — a resumed run
	// must reuse it
	expect(parsed.harness).toBe('codex');
	// a manifest with no harness fails the read boundary — there is nothing to
	// resume onto
	expect(RunManifest.safeParse(base).success).toBe(false);
});

test('RunManifest: the old driver field is not accepted as a harness — an old manifest simply fails to parse', () => {
	const oldShape = RunManifest.safeParse({ ...base, driver: 'stub' });
	const both = RunManifest.parse({ ...base, harness: 'stub', driver: 'codex' });

	// no migration and no fallback: a pre-rename manifest fails the read boundary,
	// the existing behavior for any incompatible manifest
	expect(oldShape.success).toBe(false);
	// a leftover driver key never overrides the renamed field
	expect(both.harness).toBe('stub');
	// the removed name leaves no key on the parsed manifest
	expect('driver' in both).toBe(false);
});

test('RunManifest: packages and baselineDirtyFiles default to empty arrays when absent', () => {
	const parsed = RunManifest.parse({ ...base, harness: 'codex' });

	// a manifest written before any scope was seeded reads back as unscoped, not
	// undefined — non-monorepo runs never carry the key
	expect(parsed.packages).toStrictEqual([]);
	// an absent baseline means nothing was dirty at run start, so every
	// git-reported change is attributed to the run
	expect(parsed.baselineDirtyFiles).toStrictEqual([]);
});

test('RunManifest: packagesSource records where the initial scope came from, and only the three known origins parse', () => {
	for (const packagesSource of ['flag', 'front-matter', 'plan-paths']) {
		// ${packagesSource} is a recorded scope origin — a derived scope must never be
		// mistaken for a declared one
		expect(RunManifest.parse({ ...base, harness: 'codex', packagesSource }).packagesSource).toBe(packagesSource);
	}

	// an unrecognized origin fails the read boundary rather than being recorded as
	// an unknown provenance
	expect(RunManifest.safeParse({ ...base, harness: 'codex', packagesSource: 'derived' }).success).toBe(false);
	// the field stays optional — a run with no package scope has no origin to
	// record
	expect(RunManifest.safeParse({ ...base, harness: 'codex' }).success).toBe(true);
});

test('RunManifest: pipeline names the owning pipeline, stays open, and is absent on pre-discriminator manifests', () => {
	for (const pipeline of ['implement', 'refactor', 'phases', 'coverage']) {
		// ${pipeline} owns runs of its own shape — a phases run is a coordinator over
		// per-phase runs, a coverage run loops rounds of test writing, and each must
		// read back under its own name so resume routes it to the right command
		expect(RunManifest.parse({ ...base, harness: 'codex', pipeline }).pipeline).toBe(pipeline);
	}

	// the field stays absent rather than defaulted, so a manifest written before the
	// discriminator existed reads back unchanged and callers apply their own fallback
	expect(RunManifest.parse({ ...base, harness: 'codex' }).pipeline).toBeUndefined();
	// it is still a string at the read boundary — a non-string pipeline is a corrupt
	// manifest, not an unknown pipeline
	expect(RunManifest.safeParse({ ...base, harness: 'codex', pipeline: 3 }).success).toBe(false);
});

test('RunManifest: steps are validated as step records — one malformed step fails the whole manifest', () => {
	const step = { id: 'implement', status: 'failed', attempts: 2, durationMs: 4200, changedFiles: ['src/a.ts'], error: 'gate check failed' };

	const parsed = RunManifest.parse({ ...base, harness: 'codex', steps: [step] });

	// each step round-trips whole — the manifest is the only state a resumed run
	// reads
	expect(parsed.steps).toStrictEqual([step]);
	// a step missing its attempt count fails the manifest rather than resuming
	// with an unknown retry position
	expect(RunManifest.safeParse({ ...base, harness: 'codex', steps: [{ id: 'implement', status: 'running' }] }).success).toBe(false);
});

test('RunManifest: the run status is a closed set — every pausable state parses and an unknown one does not', () => {
	for (const status of ['pending', 'running', 'passed', 'failed', 'paused-rate-limit', 'paused-budget', 'escalated']) {
		// ${status} is a durable run state — the two paused ones are resumable, not
		// errors
		expect(RunManifest.parse({ ...base, harness: 'codex', status }).status).toBe(status);
	}

	// an unrecognized run state fails the read boundary rather than resuming into
	// a branch nothing handles
	expect(RunManifest.safeParse({ ...base, harness: 'codex', status: 'cancelled' }).success).toBe(false);
});

test('RunManifest: the config snapshot and the usage aggregate are optional and survive parsing intact', () => {
	const config = { harness: 'codex', effort: 'high', gates: { check: 'c', test: 't', testCoverage: false } };
	const usage = { invocations: 7, inputTokens: 10, outputTokens: 100, cacheReadTokens: 880, cacheCreationTokens: 110, costUsd: 0.5 };

	const parsed = RunManifest.parse({ ...base, harness: 'codex', config, usage });

	// the snapshot is the permanent record of which settings produced this run —
	// resume executes with the current file, this preserves what it started with
	expect(parsed.config).toStrictEqual(config);
	// the run-wide aggregate round-trips with its invocation count
	expect(parsed.usage).toStrictEqual(usage);
	// both stay optional — a driver reporting no usage and a run predating the
	// snapshot still parse
	expect(RunManifest.safeParse({ ...base, harness: 'codex' }).success).toBe(true);
});

test('RunManifest: an unparseable config snapshot fails the manifest', () => {
	const stale = { ...base, harness: 'codex', config: { driver: 'codex', gates: { check: 'c', test: 't', testCoverage: false } } };

	// the snapshot is a real config, held to the same read boundary — a manifest
	// cannot smuggle in a shape the config schema refuses
	expect(RunManifest.safeParse(stale).success).toBe(false);
});
