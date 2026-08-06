import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, test } from '@jest/globals';
import { readRunManifest } from '@/runState';
import { createRun, getRunDir, writeRunManifest } from '@/runState';
import { readStandards } from '@/standards';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

test('manifest write → read round trip', async () => {
	const cwd = setupConsumerRepo({ git: false });
	const created = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });
	const read = await readRunManifest({ cwd, runId: created.runId });

	// JSON round-trip drops explicitly-undefined optional keys (overview).
	expect(read).toStrictEqual(JSON.parse(JSON.stringify(created)));
	expect(read.plan).toBe('plan.md');
	expect(read.harness).toBe('stub');
	expect(read.status).toBe('pending');
	expect(read.steps).toStrictEqual([]);
});

test('writeRunManifest stamps updatedAt on every write', async () => {
	const cwd = setupConsumerRepo({ git: false });
	const created = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

	await sleep(10);

	const rewritten = await writeRunManifest({ cwd, manifest: created });

	// ${rewritten.updatedAt} should be after ${created.updatedAt}
	expect(rewritten.updatedAt > created.updatedAt).toBeTruthy();
	expect(rewritten.createdAt).toBe(created.createdAt);
});

test('writeRunManifest leaves no temporary file beside the manifest it swapped in', async () => {
	const cwd = setupConsumerRepo({ git: false });
	const created = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

	await writeRunManifest({ cwd, manifest: created });

	const runDir = getRunDir({ cwd, runId: created.runId });

	// the manifest is in place
	expect(existsSync(join(runDir, 'manifest.json'))).toBeTruthy();
	// the tmp file is renamed over, never left behind
	expect(existsSync(join(runDir, 'manifest.json.tmp'))).toBeFalsy();
	expect(readdirSync(runDir)).toStrictEqual(['manifest.json']);
});

test('a run with no manifest on disk is rejected at the read boundary', async () => {
	const cwd = setupConsumerRepo({ git: false });

	await expect(readRunManifest({ cwd, runId: 'never-created' })).rejects.toThrow(/ENOENT/);
});

test('corrupted manifest is rejected at the read boundary', async () => {
	const cwd = setupConsumerRepo({ git: false });
	const created = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

	writeFileSync(join(getRunDir({ cwd, runId: created.runId }), 'manifest.json'), 'not json at all');
	await expect(readRunManifest({ cwd, runId: created.runId })).rejects.toThrow();

	writeFileSync(join(getRunDir({ cwd, runId: created.runId }), 'manifest.json'), '{"runId":"x"}');
	await expect(readRunManifest({ cwd, runId: created.runId })).rejects.toThrow();
});

test('readStandards throws on a declared-but-missing file', async () => {
	const cwd = setupConsumerRepo({ git: false });

	await expect(readStandards({ cwd, paths: ['missing-card.md'] })).rejects.toThrow(/standards file not found/);
});

test('readStandards inlines declared files with their path as provenance', async () => {
	const cwd = setupConsumerRepo({ git: false });

	writeFileSync(join(cwd, 'card.md'), 'RULE-SENTINEL');

	const standards = await readStandards({ cwd, paths: ['card.md'] });

	expect(standards?.includes('RULE-SENTINEL')).toBeTruthy();
	expect(standards?.includes('card.md')).toBeTruthy();
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

	// nested markdown inlined
	expect(standards.includes('FIRST-SENTINEL')).toBeTruthy();
	// nested markdown inlined
	expect(standards.includes('SECOND-SENTINEL')).toBeTruthy();
	// top-level markdown inlined
	expect(standards.includes('TOP-SENTINEL')).toBeTruthy();
	// non-markdown files are skipped
	expect(standards.includes('TXT-SENTINEL')).toBeFalsy();

	// per-file provenance
	expect(standards.includes('<!-- guides/a/first.md -->')).toBeTruthy();
	// per-file provenance
	expect(standards.includes('<!-- guides/b/second.md -->')).toBeTruthy();
	// per-file provenance
	expect(standards.includes('<!-- guides/top.md -->')).toBeTruthy();

	// folder files inline in sorted path order
	expect(standards.indexOf('<!-- guides/a/first.md -->') < standards.indexOf('<!-- guides/b/second.md -->')).toBeTruthy();
	// folder files inline in sorted path order
	expect(standards.indexOf('<!-- guides/b/second.md -->') < standards.indexOf('<!-- guides/top.md -->')).toBeTruthy();
	// entry order preserved
	expect(standards.indexOf('TOP-SENTINEL') < standards.indexOf('CARD-SENTINEL')).toBeTruthy();
});

test('readStandards trims a trailing slash from a folder entry in provenance headers', async () => {
	const cwd = setupConsumerRepo({ git: false });

	mkdirSync(join(cwd, 'guides/a'), { recursive: true });
	writeFileSync(join(cwd, 'guides/top.md'), 'TOP-SENTINEL');
	writeFileSync(join(cwd, 'guides/a/first.md'), 'FIRST-SENTINEL');

	const standards = (await readStandards({ cwd, paths: ['guides/'] })) ?? '';

	// no doubled slash in provenance
	expect(standards.includes('<!-- guides/top.md -->')).toBeTruthy();
	// no doubled slash in nested provenance
	expect(standards.includes('<!-- guides/a/first.md -->')).toBeTruthy();
	// entry spelling is normalised, not concatenated
	expect(standards.includes('guides//')).toBeFalsy();
	// markdown still inlined
	expect(standards.includes('TOP-SENTINEL') && standards.includes('FIRST-SENTINEL')).toBeTruthy();
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

	// regular markdown inlined
	expect(standards.includes('REAL-SENTINEL')).toBeTruthy();
	// symlinked markdown files are not collected
	expect(standards.includes('LINKED-SENTINEL')).toBeFalsy();
	// symlinked directories are not walked
	expect(standards.includes('DEEP-SENTINEL')).toBeFalsy();
});

test('readStandards throws on a folder entry with no markdown files', async () => {
	const cwd = setupConsumerRepo({ git: false });

	mkdirSync(join(cwd, 'empty-guides'), { recursive: true });
	writeFileSync(join(cwd, 'empty-guides/readme.txt'), 'TXT-SENTINEL');

	await expect(readStandards({ cwd, paths: ['empty-guides'] })).rejects.toThrow(/contains no markdown files/);
});

test('readStandards resolves bundled-default tokens and stacks them with files', async () => {
	const cwd = setupConsumerRepo({ git: false });

	writeFileSync(join(cwd, 'extras.md'), 'EXTRAS-SENTINEL');

	const code = await readStandards({ cwd, paths: ['lightsout:code-defaults', 'extras.md'] });
	const tests = await readStandards({ cwd, paths: ['lightsout:test-defaults'] });

	// code defaults bundled
	expect(code?.includes('One Export Per File')).toBeTruthy();
	// provenance headers present
	expect(code?.includes('lightsout defaults: standards/code/')).toBeTruthy();
	// repo extras stack after the token
	expect(code?.includes('EXTRAS-SENTINEL')).toBeTruthy();
	// test defaults bundled
	expect(tests?.includes('Module Boundary Testing')).toBeTruthy();
});
