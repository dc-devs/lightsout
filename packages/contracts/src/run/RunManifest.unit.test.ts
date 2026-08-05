import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunManifest } from '../index';

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
