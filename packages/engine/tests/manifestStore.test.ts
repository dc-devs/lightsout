import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { createRun, getRunDir, readRunManifest, writeRunManifest } from '../src/index';
import { readStandards } from '../src/readStandards';
import { setupConsumerRepo } from './helpers/setupConsumerRepo';

test('manifest write → read round trip', async () => {
	const cwd = setupConsumerRepo({ git: false });
	const created = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });
	const read = await readRunManifest({ cwd, runId: created.runId });

	// JSON round-trip drops explicitly-undefined optional keys (overview).
	assert.deepEqual(read, JSON.parse(JSON.stringify(created)));
	assert.equal(read.plan, 'plan.md');
	assert.equal(read.driver, 'stub');
	assert.equal(read.status, 'pending');
	assert.deepEqual(read.steps, []);
});

test('writeRunManifest stamps updatedAt on every write', async () => {
	const cwd = setupConsumerRepo({ git: false });
	const created = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

	await sleep(10);

	const rewritten = await writeRunManifest({ cwd, manifest: created });

	assert.ok(rewritten.updatedAt > created.updatedAt, `${rewritten.updatedAt} should be after ${created.updatedAt}`);
	assert.equal(rewritten.createdAt, created.createdAt);
});

test('corrupted manifest is rejected at the read boundary', async () => {
	const cwd = setupConsumerRepo({ git: false });
	const created = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

	writeFileSync(join(getRunDir({ cwd, runId: created.runId }), 'manifest.json'), 'not json at all');
	await assert.rejects(readRunManifest({ cwd, runId: created.runId }));

	writeFileSync(join(getRunDir({ cwd, runId: created.runId }), 'manifest.json'), '{"runId":"x"}');
	await assert.rejects(readRunManifest({ cwd, runId: created.runId }));
});

test('readStandards throws on a declared-but-missing file', async () => {
	const cwd = setupConsumerRepo({ git: false });

	await assert.rejects(readStandards({ cwd, paths: ['missing-card.md'] }), /standards file not found/);
});

test('readStandards inlines declared files with their path as provenance', async () => {
	const cwd = setupConsumerRepo({ git: false });

	writeFileSync(join(cwd, 'card.md'), 'RULE-SENTINEL');

	const standards = await readStandards({ cwd, paths: ['card.md'] });

	assert.ok(standards?.includes('RULE-SENTINEL'));
	assert.ok(standards?.includes('card.md'));
});
