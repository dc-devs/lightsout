import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { readRunManifest } from '../index';
import { createRun, getRunDir, writeRunManifest } from './index';
import { readStandards } from '../standards';
import { setupConsumerRepo } from '../../tests/helpers/setupConsumerRepo';

test('manifest write → read round trip', async () => {
	const cwd = setupConsumerRepo({ git: false });
	const created = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });
	const read = await readRunManifest({ cwd, runId: created.runId });

	// JSON round-trip drops explicitly-undefined optional keys (overview).
	assert.deepEqual(read, JSON.parse(JSON.stringify(created)));
	assert.equal(read.plan, 'plan.md');
	assert.equal(read.harness, 'stub');
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

test('readStandards expands a folder entry recursively in sorted order with per-file provenance', async () => {
	const cwd = setupConsumerRepo({ git: false });

	mkdirSync(join(cwd, 'guides/a'), { recursive: true });
	mkdirSync(join(cwd, 'guides/b'), { recursive: true });
	writeFileSync(join(cwd, 'guides/top.md'), 'TOP-SENTINEL');
	writeFileSync(join(cwd, 'guides/a/first.md'), 'FIRST-SENTINEL');
	writeFileSync(join(cwd, 'guides/b/second.md'), 'SECOND-SENTINEL');
	writeFileSync(join(cwd, 'guides/notes.txt'), 'TXT-SENTINEL');
	writeFileSync(join(cwd, 'card.md'), 'CARD-SENTINEL');

	const standards = (await readStandards({ cwd, paths: ['guides', 'card.md'] })) ?? '';

	assert.ok(standards.includes('FIRST-SENTINEL'), 'nested markdown inlined');
	assert.ok(standards.includes('SECOND-SENTINEL'), 'nested markdown inlined');
	assert.ok(standards.includes('TOP-SENTINEL'), 'top-level markdown inlined');
	assert.ok(!standards.includes('TXT-SENTINEL'), 'non-markdown files are skipped');

	assert.ok(standards.includes('<!-- guides/a/first.md -->'), 'per-file provenance');
	assert.ok(standards.includes('<!-- guides/b/second.md -->'), 'per-file provenance');
	assert.ok(standards.includes('<!-- guides/top.md -->'), 'per-file provenance');

	assert.ok(
		standards.indexOf('<!-- guides/a/first.md -->') < standards.indexOf('<!-- guides/b/second.md -->'),
		'folder files inline in sorted path order',
	);
	assert.ok(
		standards.indexOf('<!-- guides/b/second.md -->') < standards.indexOf('<!-- guides/top.md -->'),
		'folder files inline in sorted path order',
	);
	assert.ok(standards.indexOf('TOP-SENTINEL') < standards.indexOf('CARD-SENTINEL'), 'entry order preserved');
});

test('readStandards trims a trailing slash from a folder entry in provenance headers', async () => {
	const cwd = setupConsumerRepo({ git: false });

	mkdirSync(join(cwd, 'guides/a'), { recursive: true });
	writeFileSync(join(cwd, 'guides/top.md'), 'TOP-SENTINEL');
	writeFileSync(join(cwd, 'guides/a/first.md'), 'FIRST-SENTINEL');

	const standards = (await readStandards({ cwd, paths: ['guides/'] })) ?? '';

	assert.ok(standards.includes('<!-- guides/top.md -->'), 'no doubled slash in provenance');
	assert.ok(standards.includes('<!-- guides/a/first.md -->'), 'no doubled slash in nested provenance');
	assert.ok(!standards.includes('guides//'), 'entry spelling is normalised, not concatenated');
	assert.ok(standards.includes('TOP-SENTINEL') && standards.includes('FIRST-SENTINEL'), 'markdown still inlined');
});

test('readStandards does not follow or collect symlinks inside a folder entry', async () => {
	const cwd = setupConsumerRepo({ git: false });

	mkdirSync(join(cwd, 'guides'), { recursive: true });
	mkdirSync(join(cwd, 'elsewhere'), { recursive: true });
	writeFileSync(join(cwd, 'guides/real.md'), 'REAL-SENTINEL');
	writeFileSync(join(cwd, 'outside.md'), 'LINKED-SENTINEL');
	writeFileSync(join(cwd, 'elsewhere/deep.md'), 'DEEP-SENTINEL');
	symlinkSync(join(cwd, 'outside.md'), join(cwd, 'guides/linked.md'));
	symlinkSync(join(cwd, 'elsewhere'), join(cwd, 'guides/linked-dir'));

	const standards = (await readStandards({ cwd, paths: ['guides'] })) ?? '';

	assert.ok(standards.includes('REAL-SENTINEL'), 'regular markdown inlined');
	assert.ok(!standards.includes('LINKED-SENTINEL'), 'symlinked markdown files are not collected');
	assert.ok(!standards.includes('DEEP-SENTINEL'), 'symlinked directories are not walked');
});

test('readStandards throws on a folder entry with no markdown files', async () => {
	const cwd = setupConsumerRepo({ git: false });

	mkdirSync(join(cwd, 'empty-guides'), { recursive: true });
	writeFileSync(join(cwd, 'empty-guides/readme.txt'), 'TXT-SENTINEL');

	await assert.rejects(readStandards({ cwd, paths: ['empty-guides'] }), /contains no markdown files/);
});

test('readStandards resolves bundled-default tokens and stacks them with files', async () => {
	const cwd = setupConsumerRepo({ git: false });

	writeFileSync(join(cwd, 'extras.md'), 'EXTRAS-SENTINEL');

	const code = await readStandards({ cwd, paths: ['lightsout:code-defaults', 'extras.md'] });
	const tests = await readStandards({ cwd, paths: ['lightsout:test-defaults'] });

	assert.ok(code?.includes('One Export Per File'), 'code defaults bundled');
	assert.ok(code?.includes('lightsout defaults: standards/code/'), 'provenance headers present');
	assert.ok(code?.includes('EXTRAS-SENTINEL'), 'repo extras stack after the token');
	assert.ok(tests?.includes('Module Boundary Testing'), 'test defaults bundled');
});
