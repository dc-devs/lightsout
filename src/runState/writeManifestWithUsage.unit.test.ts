import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RunManifest, RunUsage } from '@/contracts';
import { createRun, readRunManifest, writeManifestWithUsage } from '@/runState';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/** Every field a different number so a mix-up shows. */
const spentTotals: RunUsage = {
	invocations: 3,
	inputTokens: 10,
	outputTokens: 100,
	cacheReadTokens: 880,
	cacheCreationTokens: 110,
	costUsd: 0.5,
};

const zeroTotals: RunUsage = {
	invocations: 0,
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheCreationTokens: 0,
	costUsd: 0,
};

interface SetupParams {
	/** Usage already persisted on the manifest — what a resumed run carries in. */
	persistedUsage?: RunUsage;
	/** The run's live aggregate at write time. */
	usageTotals?: RunUsage;
}

const setupManifest = async ({ persistedUsage, usageTotals = zeroTotals }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });
	const created = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });
	const manifest: RunManifest = { ...created, usage: persistedUsage };

	return { cwd, manifest, usageTotals: { ...usageTotals } };
};

describe('writeManifestWithUsage', () => {
	test('stamps the run live totals into the manifest once an invocation has landed', async () => {
		const { cwd, manifest, usageTotals } = await setupManifest({ usageTotals: spentTotals });

		const written = await writeManifestWithUsage({ cwd, manifest, usageTotals });

		assert.deepEqual(written.usage, {
			invocations: 3,
			inputTokens: 10,
			outputTokens: 100,
			cacheReadTokens: 880,
			cacheCreationTokens: 110,
			costUsd: 0.5,
		});
	});

	test('preserves the usage a resumed run carries in until its first invocation lands', async () => {
		const { cwd, manifest, usageTotals } = await setupManifest({ persistedUsage: spentTotals, usageTotals: zeroTotals });

		const written = await writeManifestWithUsage({ cwd, manifest, usageTotals });

		assert.deepEqual(written.usage, spentTotals, 'a resumed run that has not spent yet must not zero its history');
	});

	test('leaves usage absent for a fresh run whose driver has reported nothing', async () => {
		const { cwd, manifest, usageTotals } = await setupManifest();

		const written = await writeManifestWithUsage({ cwd, manifest, usageTotals });

		assert.equal(written.usage, undefined);
	});

	test('applies the patch over the manifest it was handed', async () => {
		const { cwd, manifest, usageTotals } = await setupManifest({ usageTotals: spentTotals });

		const written = await writeManifestWithUsage({
			cwd,
			manifest,
			patch: { status: 'passed', currentStep: null, changedFiles: ['src/feature.js'] },
			usageTotals,
		});

		assert.equal(written.status, 'passed');
		assert.deepEqual(written.changedFiles, ['src/feature.js']);
		assert.equal(written.plan, 'plan.md', 'fields the patch does not name survive');
	});

	test('persists the patched manifest to disk, not just to the returned value', async () => {
		const { cwd, manifest, usageTotals } = await setupManifest({ usageTotals: spentTotals });

		await writeManifestWithUsage({ cwd, manifest, patch: { status: 'running', currentStep: 'implement' }, usageTotals });

		const read = await readRunManifest({ cwd, runId: manifest.runId });

		assert.equal(read.status, 'running');
		assert.equal(read.currentStep, 'implement');
		assert.deepEqual(read.usage, spentTotals);
	});

	test('snapshots the totals so later spend cannot rewrite an already-written manifest', async () => {
		const { cwd, manifest, usageTotals } = await setupManifest({ usageTotals: spentTotals });

		const written = await writeManifestWithUsage({ cwd, manifest, usageTotals });

		usageTotals.invocations += 1;
		usageTotals.costUsd += 10;

		assert.equal(written.usage?.invocations, 3);
		assert.equal(written.usage?.costUsd, 0.5);
	});

	test('stamps updatedAt on the write like every other manifest write', async () => {
		const { cwd, manifest, usageTotals } = await setupManifest({ usageTotals: spentTotals });

		const written = await writeManifestWithUsage({ cwd, manifest, usageTotals });

		assert.ok(written.updatedAt >= manifest.updatedAt, `${written.updatedAt} should not precede ${manifest.updatedAt}`);
		assert.equal(written.createdAt, manifest.createdAt);
	});
});
