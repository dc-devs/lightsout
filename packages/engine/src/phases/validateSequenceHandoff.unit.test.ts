import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { PipelineKind, PlanningHandoff, RunStatus } from '#src/contracts/index.ts';
import { validateSequenceHandoff } from '#src/phases/validateSequenceHandoff.ts';
import { createRun, writeRunManifest } from '#src/runState/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const setup = async ({ defect }: { defect?: string } = {}) => {
	const cwd = setupConsumerRepo();
	const config = await readConfig({ cwd });
	const planningHandoff = PlanningHandoff.parse({
		format: 'planning-handoff-v1',
		name: 'retry',
		generation: 'a'.repeat(64),
		phases: [
			{ id: 'first', path: 'phase1.md' },
			{ id: 'second', path: 'phase2.md' },
		],
	});
	const parent = await createRun({ cwd, config, plan: '.lightsout/plans/retry/overview.md', pipeline: PipelineKind.Phases, driver: 'stub', planningHandoff });
	const child = await createRun({
		cwd,
		config,
		plan: defect === 'path' ? 'wrong.md' : '.lightsout/plans/retry/phase1.md',
		parentRunId: defect === 'parent' ? 'wrong-parent' : parent.runId,
		driver: 'stub',
		planningHandoff: defect === 'handoff' ? { ...planningHandoff, generation: 'b'.repeat(64) } : planningHandoff,
	});
	await writeRunManifest({ cwd, manifest: { ...child, status: defect === 'status' ? RunStatus.Failed : RunStatus.Passed } });
	const manifest = {
		...parent,
		steps: [
			{ id: defect === 'order' ? 'phase2.md' : 'phase1.md', status: RunStatus.Passed, attempts: 1, report: { runId: child.runId } },
			{ id: 'phase2.md', status: RunStatus.Pending, attempts: 0 },
		],
	};
	return { cwd, manifest };
};

describe('validateSequenceHandoff', () => {
	test.each(['order', 'status', 'parent', 'path', 'handoff'])('rejects inconsistent recorded prerequisite: %s', async (defect) => {
		const fixture = await setup({ defect });
		await expect(validateSequenceHandoff(fixture)).rejects.toThrow(/frozen phase order|matching child/);
	});
	test('retains an unfinished phase sequence and its valid predecessor', async () => {
		const fixture = await setup();
		expect(await validateSequenceHandoff(fixture)).toStrictEqual(fixture.manifest);
	});
	test('leaves legacy sequence semantics unchanged', async () => {
		const fixture = await setup();
		const manifest = { ...fixture.manifest, planningHandoff: undefined };
		expect(await validateSequenceHandoff({ ...fixture, manifest })).toStrictEqual(manifest);
	});
});
