import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, test } from '@jest/globals';
import { RunStatus } from '#src/contracts/index.ts';
import { createRun, getRunDir, RunNotFoundError, readRunManifest, writeRunManifest } from '#src/runState/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

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

test('writeRunManifest persists the manifest it is handed, and returns exactly what a reader gets back', async () => {
	const cwd = setupConsumerRepo({ git: false });
	const created = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

	const written = await writeRunManifest({
		cwd,
		manifest: { ...created, status: RunStatus.Passed, currentStep: 'write-tests', changedFiles: ['src/index.js'] },
	});

	const read = await readRunManifest({ cwd, runId: created.runId });

	expect(read.status).toBe('passed');
	expect(read.currentStep).toBe('write-tests');
	expect(read.changedFiles).toStrictEqual(['src/index.js']);
	// JSON round-trip drops explicitly-undefined optional keys (overview).
	expect(read).toStrictEqual(JSON.parse(JSON.stringify(written)));
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

test('a run id no directory answers to is rejected before any file is opened', async () => {
	const cwd = setupConsumerRepo({ git: false });

	await expect(readRunManifest({ cwd, runId: 'never-created' })).rejects.toThrow(RunNotFoundError);
});

test('a run directory left without its manifest is rejected at the read boundary', async () => {
	const cwd = setupConsumerRepo({ git: false });

	// an interrupted create leaves the directory but no manifest inside it
	mkdirSync(getRunDir({ cwd, runId: 'half-created' }), { recursive: true });

	await expect(readRunManifest({ cwd, runId: 'half-created' })).rejects.toThrow(/ENOENT/);
});

test('corrupted manifest is rejected at the read boundary', async () => {
	const cwd = setupConsumerRepo({ git: false });
	const created = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

	writeFileSync(join(getRunDir({ cwd, runId: created.runId }), 'manifest.json'), 'not json at all');
	await expect(readRunManifest({ cwd, runId: created.runId })).rejects.toThrow();

	writeFileSync(join(getRunDir({ cwd, runId: created.runId }), 'manifest.json'), '{"runId":"x"}');
	await expect(readRunManifest({ cwd, runId: created.runId })).rejects.toThrow();
});
