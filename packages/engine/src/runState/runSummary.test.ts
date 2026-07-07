import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@lightsout/drivers';
import { loadConfig, runImplementPipeline, summarizeRun } from '../index';
import { report } from '../../tests/helpers/report';
import { roleOf } from '../../tests/helpers/roleOf';
import { setupConsumerRepo } from '../../tests/helpers/setupConsumerRepo';

const usage = {
	inputTokens: 10,
	outputTokens: 100,
	cacheReadTokens: 880,
	cacheCreationTokens: 110,
	costUsd: 0.5,
};

test('summarizeRun aggregates step durations, per-step usage, files, gates, and friction', async () => {
	const dir = setupConsumerRepo();

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'write-tests') {
				writeFileSync(join(dir, 'test.feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test.feature.test.js', summary: 'tests' }] }), exitCode: 0, usage };
			}

			if (role === 'refactor') {
				return {
					text: report({ friction: [{ kind: 'decision', area: 'plan', detail: 'guessed a boundary' }] }),
					exitCode: 0,
					usage,
				};
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0, usage };
		},
	};

	const config = await loadConfig({ cwd: dir });
	const result = await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

	assert.equal(result.ok, true);

	const summary = await summarizeRun({ cwd: dir, manifest: result.manifest });

	assert.ok(summary.wallMs >= 0);
	assert.ok(summary.activeMs > 0, 'active time summed from step durations');
	assert.ok(summary.gateMs > 0, 'gate time measured from commands.jsonl');
	assert.ok(summary.gates.commands > 0);

	const byId = new Map(summary.steps.map((step) => [step.id, step]));
	const implement = byId.get('implement');
	const writeTests = byId.get('write-tests');
	const refactor = byId.get('refactor');
	const cleanSlate = byId.get('clean-slate');

	assert.ok(implement && typeof implement.durationMs === 'number', 'implement duration stamped');
	assert.deepEqual(implement.changedFiles, ['src/feature.js']);
	assert.equal(implement.invocations, 1);
	assert.equal(implement.outputTokens, 100);
	assert.equal(implement.costUsd, 0.5);

	assert.deepEqual(writeTests?.changedFiles, ['test.feature.test.js']);
	assert.equal(writeTests?.invocations, 1);

	// The refactor loop reported zero changes on its first pass — attributed
	// as an explicit empty list, distinct from steps that never change files.
	assert.deepEqual(refactor?.changedFiles, []);
	assert.equal(refactor?.invocations, 1);

	assert.equal(cleanSlate?.invocations, 0, 'gate-only steps bill no agents');
	assert.equal(cleanSlate?.changedFiles, undefined);

	assert.equal(summary.cacheReadShare, 0.88);
	assert.equal(summary.rejectedReports, 0);
	assert.deepEqual(summary.frictionByArea, [{ area: 'plan', count: 1 }]);
});

test('summarizeRun tolerates a run dir with no ledger, no commands, no friction', async () => {
	const summary = await summarizeRun({
		cwd: '/nonexistent',
		manifest: {
			runId: 'ghost',
			createdAt: '2026-07-03T00:00:00.000Z',
			updatedAt: '2026-07-03T00:10:00.000Z',
			plan: 'plan.md',
			driver: 'stub',
			status: 'failed',
			currentStep: null,
			steps: [{ id: 'clean-slate', status: 'failed', attempts: 1 }],
			changedFiles: [],
			packages: [],
			baselineDirtyFiles: [],
		},
	});

	assert.equal(summary.wallMs, 600_000);
	assert.equal(summary.activeMs, 0);
	assert.equal(summary.gateMs, 0);
	assert.equal(summary.usage, undefined);
	assert.equal(summary.cacheReadShare, undefined);
	assert.equal(summary.gates.commands, 0);
	assert.equal(summary.rejectedReports, 0);
	assert.deepEqual(summary.frictionByArea, []);
	assert.deepEqual(summary.steps, [
		{ id: 'clean-slate', status: 'failed', attempts: 1, durationMs: undefined, changedFiles: undefined, invocations: 0, outputTokens: 0, costUsd: 0 },
	]);
});
