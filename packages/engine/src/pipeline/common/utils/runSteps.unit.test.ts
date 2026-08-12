import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type LightsoutConfig, RunStatus } from '@/contracts';
import type { Driver } from '@/drivers';
import { runSteps } from '@/pipeline/common/utils/runSteps';
import { PipelineRun } from '@/pipeline/PipelineRun';
import type { PipelineStep } from '@/pipeline/PipelineStep';
import { createRun } from '@/runState';

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', testCoverage: false } };
const idleDriver: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 0 }) };

/**
 * A real run over a temp repo. Real rather than faked because a skipped step is
 * asserted through the manifest it writes — a stub that skipped the write would
 * pass while recording nothing.
 */
const setupRun = async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-run-steps-'));
	const progress: string[] = [];
	const manifest = await createRun({ cwd, plan: 'plan.md', pipeline: 'implement', driver: idleDriver.name, config });

	return { run: new PipelineRun({ cwd, config, driver: idleDriver, manifest, onProgress: (line) => progress.push(line) }), progress };
};

/** A step that records it ran, and optionally stops the run. */
const step = ({ id, ran, skip, stops }: { id: string; ran: string[]; skip?: string; stops?: boolean }): PipelineStep => ({
	id,
	skip: skip === undefined ? undefined : () => skip,
	run: async () => {
		ran.push(id);

		return stops ? { ok: false, manifest: undefined as never, error: `${id} stopped` } : undefined;
	},
});

describe('runSteps', () => {
	test('runs every step in order and returns nothing when they all pass', async () => {
		const { run } = await setupRun();
		const ran: string[] = [];

		const stopped = await runSteps({ run, steps: [step({ id: 'one', ran }), step({ id: 'two', ran })] });

		expect(ran).toStrictEqual(['one', 'two']);
		expect(stopped).toBe(undefined);
	});

	test('walks past a step the manifest already records as passed', async () => {
		const { run } = await setupRun();
		const ran: string[] = [];

		await run.setStep({ record: { id: 'one', status: RunStatus.Passed, attempts: 1 } });

		const stopped = await runSteps({ run, steps: [step({ id: 'one', ran }), step({ id: 'two', ran })] });

		// this is resume: a run that parked at step two costs nothing for step one
		expect(ran).toStrictEqual(['two']);
		expect(stopped).toBe(undefined);
	});

	test('records a skipped step as passed with its reason, rather than passing it over in silence', async () => {
		const { run, progress } = await setupRun();
		const ran: string[] = [];

		await runSteps({ run, steps: [step({ id: 'one', ran, skip: 'no source files changed' })] });

		const record = run.current().steps.find((entry) => entry.id === 'one');

		expect(ran).toStrictEqual([]);
		expect(record?.status).toBe(RunStatus.Passed);
		expect(record?.report).toStrictEqual({ skipped: 'no source files changed' });
		expect(progress).toContain('step one skipped (no source files changed)');
	});

	test('stops at the first step that stops, leaving later steps unrun', async () => {
		const { run } = await setupRun();
		const ran: string[] = [];

		const stopped = await runSteps({ run, steps: [step({ id: 'one', ran, stops: true }), step({ id: 'two', ran })] });

		expect(ran).toStrictEqual(['one']);
		expect(stopped?.error).toBe('one stopped');
	});
});
