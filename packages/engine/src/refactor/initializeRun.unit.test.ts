import { describe, expect, test } from '@jest/globals';
import { getRejectionError } from '@tests/helpers/getRejectionError';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { type LightsoutConfig, type RunManifest, RunStatus } from '@/contracts';
import type { Driver } from '@/drivers';
import { initializeRun } from '@/refactor/initializeRun';

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 0 }) };

const manifestWith = ({ pipeline }: { pipeline?: string }): RunManifest => ({
	runId: 'run-1',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	plan: '.lightsout/runs/run-1/worklist.json',
	pipeline,
	harness: 'stub',
	config,
	status: RunStatus.PausedRateLimit,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
});

describe('initializeRun', () => {
	test('refuses to resume a manifest the implement pipeline owns, naming the command that would', async () => {
		const cwd = setupConsumerRepo();

		const error = await getRejectionError({
			promise: initializeRun({ cwd, runId: 'run-1', driver, config, existing: manifestWith({ pipeline: 'implement' }) }),
		});

		expect(error.message).toMatch(/belongs to the implement pipeline — resume it with: lightsout resume --run run-1/);
	});

	test('a manifest written before the pipeline field existed is treated as an implement run', async () => {
		const cwd = setupConsumerRepo();

		// pre-discriminator manifests carry no pipeline; assuming refactor would
		// let `lightsout refactor --run` hijack somebody's implement run
		const error = await getRejectionError({ promise: initializeRun({ cwd, runId: 'run-1', driver, config, existing: manifestWith({}) }) });

		expect(error.message).toMatch(/belongs to the implement pipeline/);
	});
});
