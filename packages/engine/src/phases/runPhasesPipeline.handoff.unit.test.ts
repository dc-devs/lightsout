import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { PhaseReport } from '#src/contracts/index.ts';
import { runPhasesPipeline } from '#src/phases/index.ts';
import { getRunDir, readRunManifest } from '#src/runState/index.ts';
import { planningPhasePipelineFixture } from '#tests/helpers/planningPhasePipelineFixture.ts';
import { readPhaseChildRuns } from '#tests/helpers/readPhaseChildRuns.ts';

describe('runPhasesPipeline', () => {
	test('passes one frozen handoff through both phases and preserves predecessor acceptance', async () => {
		const fixture = await planningPhasePipelineFixture();

		const result = await runPhasesPipeline({ ...fixture, skipRefactor: true });

		expect({ ok: result.ok, error: result.error }).toStrictEqual({ ok: true, error: undefined });
		const children = await readPhaseChildRuns({ cwd: fixture.cwd, manifest: result.manifest });
		expect(children.map((child) => child.planningHandoff)).toStrictEqual([fixture.handoff, fixture.handoff]);
		expect(children[1].acceptanceTests.map((row) => row.testName)).toStrictEqual([
			'retains completed uploads after retry failure',
			'reports retained retry completion',
		]);
		expect(fixture.calls.some((call) => `${call.systemPrompt ?? ''}\n${call.prompt}`.includes('Binding implementation contract'))).toBe(true);
	});
	test('rejects a fresh later-phase start before a writer runs', async () => {
		const fixture = await planningPhasePipelineFixture();

		await expect(runPhasesPipeline({ ...fixture, startPhase: 2, skipRefactor: true })).rejects.toThrow('completed coordinator prerequisites');
		expect(fixture.calls).toStrictEqual([]);
	});
});

test('resumes a completed canonical sequence with the same child and retained approved test baseline', async () => {
	const fixture = await planningPhasePipelineFixture();
	const passed = await runPhasesPipeline({ ...fixture, skipRefactor: true });
	expect(passed.ok).toBe(true);
	const runId = PhaseReport.parse(passed.manifest.steps[1].report).runId;
	const child = await readRunManifest({ cwd: fixture.cwd, runId });
	const baseline = child.approvedTests.find((entry) => entry.path === 'src/retryReport.unit.test.ts');
	expect(baseline?.sha256).toBeDefined();
	expect(await readFile(join(getRunDir({ cwd: fixture.cwd, runId }), 'approved', 'src/retryReport.unit.test.ts'), 'utf8')).toContain(
		'reports retained retry completion',
	);
	const before = fixture.calls.length;
	const resumed = await runPhasesPipeline({ ...fixture, existing: passed.manifest, skipRefactor: true });
	expect({ ok: resumed.ok, error: resumed.error }).toStrictEqual({ ok: true, error: undefined });
	expect(PhaseReport.parse(resumed.manifest.steps[1].report).runId).toBe(runId);
	expect(fixture.calls.slice(before)).toStrictEqual([]);
});
test('keeps a newly created child identity when preparation throws, then resumes that child', async () => {
	const fixture = await planningPhasePipelineFixture();
	const failed = await runPhasesPipeline({
		...fixture,
		skipRefactor: true,
		onProgress: (message) => {
			if (message.startsWith('standards channels:')) throw new Error('Interrupted after child creation');
		},
	});
	expect(failed.ok).toBe(false);
	const runId = PhaseReport.parse(failed.manifest.steps[0].report).runId;
	expect((await readRunManifest({ cwd: fixture.cwd, runId })).parentRunId).toBe(failed.manifest.runId);
	const resumed = await runPhasesPipeline({ ...fixture, existing: failed.manifest, skipRefactor: true });
	expect({ ok: resumed.ok, error: resumed.error }).toStrictEqual({ ok: true, error: undefined });
	expect(PhaseReport.parse(resumed.manifest.steps[0].report).runId).toBe(runId);
});
