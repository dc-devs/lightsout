import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { RunState } from '@/common/services/RunState';
import { type LightsoutConfig, type RunManifest, RunStatus } from '@/contracts';

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const manifestOf = (): RunManifest => ({
	runId: 'run-state-1',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	plan: '',
	pipeline: 'refactor',
	harness: 'stub',
	status: RunStatus.Running,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
});

const setupRunState = ({ onProgress }: { onProgress?: (message: string) => void } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-run-state-'));

	mkdirSync(join(cwd, '.lightsout', 'runs', 'run-state-1'), { recursive: true });

	return { cwd, run: new RunState({ cwd, config, manifest: manifestOf(), onProgress }) };
};

describe('RunState', () => {
	test('update persists the patch and rebinds the live manifest, so current() never serves a stale read', async () => {
		const { cwd, run } = setupRunState();

		await run.update({ status: RunStatus.Passed });

		expect(run.current().status).toBe(RunStatus.Passed);
		// persisted before the next action — the crash-safety half of the contract
		const onDisk = JSON.parse(readFileSync(join(cwd, '.lightsout', 'runs', 'run-state-1', 'manifest.json'), 'utf8'));

		expect(onDisk.status).toBe(RunStatus.Passed);
	});

	test('setStep appends a new step, replaces a repeated id in place, and points currentStep at it', async () => {
		const { run } = setupRunState();

		await run.setStep({ record: { id: 'batch-01', status: RunStatus.Running, attempts: 1 } });
		await run.setStep({ record: { id: 'batch-01', status: RunStatus.Passed, attempts: 1 } });
		await run.setStep({ record: { id: 'batch-02', status: RunStatus.Running, attempts: 1 } });

		expect(run.current().steps.map((step) => [step.id, step.status])).toStrictEqual([
			['batch-01', RunStatus.Passed],
			['batch-02', RunStatus.Running],
		]);
		expect(run.current().currentStep).toBe('batch-02');
	});

	test('progress forwards to the listener, and a run with no listener stays silent instead of crashing', () => {
		const messages: string[] = [];
		const { run } = setupRunState({ onProgress: (message) => messages.push(message) });

		run.progress('working');

		expect(messages).toStrictEqual(['working']);
		expect(() => setupRunState().run.progress('unheard')).not.toThrow();
	});

	test('the agent timeout reads the config, with the one-hour default when the config is silent', () => {
		const { cwd } = setupRunState();

		expect(new RunState({ cwd, config, manifest: manifestOf() }).agentTimeoutMs).toBe(60 * 60_000);
		expect(new RunState({ cwd, config: { ...config, timeouts: { 'agent-minutes': 5 } }, manifest: manifestOf() }).agentTimeoutMs).toBe(5 * 60_000);
	});
});
