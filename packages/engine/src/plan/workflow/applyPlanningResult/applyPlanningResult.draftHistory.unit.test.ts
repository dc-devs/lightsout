import { describe, expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { applyPlanningResult, invokePlanningRole, readPlanningSnapshot } from '#src/plan/index.ts';
import { renderPlanningSections } from '#src/plan/workflow/draft/index.ts';
import { planningDraftFixture } from '#tests/helpers/planningDraftFixture.ts';
import { planningDraftHistoryFixture } from '#tests/helpers/planningDraftHistoryFixture.ts';

const setup = async ({ brokenRenderer = false, changedPolicy = false } = {}) => {
	const fixture = await planningDraftFixture({ repair: true });
	fixture.runtime.services.render = renderPlanningSections;
	const proposal = await invokePlanningRole({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work });
	const before = await readPlanningSnapshot(fixture);
	if (!before) throw new Error('Expected an immutable invocation before acceptance');
	if (brokenRenderer)
		fixture.runtime.services.render = () => {
			throw new Error('Unrepresented authored obligation must survive');
		};
	if (changedPolicy) fixture.runtime.model = 'new-selected-model';
	return { ...fixture, proposal, before };
};

describe('applyPlanningResult', () => {
	test('retains real author and review history across a split and remaps only the current finding resolution path', async () => {
		const fixture = await planningDraftHistoryFixture();
		const proposal = await invokePlanningRole({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work });
		const before = await readPlanningSnapshot(fixture);
		if (!before) throw new Error('Split invocation must be persisted');

		const accepted = await applyPlanningResult({ runtime: fixture.runtime, result: proposal });

		expect(accepted.accepted).toBe(true);
		expect(accepted.snapshot.record.reviewReceipts).toEqual(before.record.reviewReceipts);
		expect(accepted.snapshot.record.findings.find(({ id }) => id === fixture.finding.id)).toEqual({
			...fixture.finding,
			state: PlanningVocabulary.FindingState.Repairing,
			resolutionArtifacts: ['phase1-upload.md'],
		});
		expect(accepted.snapshot.artifacts.get('phase3-report.md')).toBe(before.artifacts.get('phase3-report.md'));
		expect(accepted.snapshot.record.work.find(({ id }) => id === 'review-c')).toEqual(before.record.work.find(({ id }) => id === 'review-c'));
		expect(accepted.snapshot.record.artifacts.find(({ phaseId }) => phaseId === 'C')).toEqual(before.record.artifacts.find(({ phaseId }) => phaseId === 'C'));
		expect(accepted.snapshot.record.artifacts.find(({ phaseId }) => phaseId === 'A')?.path).toBe('phase1-upload.md');
		expect(accepted.snapshot.artifacts.has('phase1-original.md')).toBe(false);
		for (const [path, text] of before.artifacts)
			if (path.startsWith('planning-results/') || path.startsWith('planning-baselines/') || path.startsWith('planning-invocations/'))
				expect(accepted.snapshot.artifacts.get(path)).toBe(text);
	}, 60_000);

	test('rejects projection failure without publishing partial phase moves or new receipt authority', async () => {
		const fixture = await setup({ brokenRenderer: true });

		const acceptance = applyPlanningResult({ runtime: fixture.runtime, result: fixture.proposal });

		await expect(acceptance).rejects.toThrow('Unrepresented authored obligation must survive');
		const after = await readPlanningSnapshot(fixture);
		expect(after?.digest).toBe(fixture.before.digest);
		expect(after?.artifacts).toEqual(fixture.before.artifacts);
		expect(after?.record.work.find(({ id }) => id === fixture.work.id)?.status).toBe(PlanningVocabulary.WorkState.Running);
	});

	test('rejects an output when the selected model changes after its bound invocation', async () => {
		const fixture = await setup({ changedPolicy: true });

		const acceptance = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.proposal });

		expect(acceptance.accepted).toBe(false);
		expect(acceptance.reason).toContain('inputs changed');
		expect(acceptance.snapshot.digest).toBe(fixture.before.digest);
		expect(acceptance.snapshot.artifacts).toEqual(fixture.before.artifacts);
	});
});

test('applyPlanningResult refuses a renderer that omits a declared artifact without publishing a partial move', async () => {
	const fixture = await setup();
	fixture.runtime.services.render = () => new Map();

	const acceptance = applyPlanningResult({ runtime: fixture.runtime, result: fixture.proposal });

	await expect(acceptance).rejects.toThrow('Rendering omitted a canonical artifact: overview.md');
	const after = await readPlanningSnapshot(fixture);
	expect(after?.digest).toBe(fixture.before.digest);
	expect(after?.artifacts).toEqual(fixture.before.artifacts);
	expect(after?.record.work.find(({ id }) => id === fixture.work.id)?.status).toBe(PlanningVocabulary.WorkState.Running);
});

test('applyPlanningResult refuses a phase rename without its replacement bytes and retains the original layout', async () => {
	const fixture = await setup();
	if (!('artifactEdits' in fixture.proposal)) throw new Error('Expected an authoring proposal');
	const proposal = { ...fixture.proposal, artifactEdits: fixture.proposal.artifactEdits.filter(({ path }) => path !== 'phase1-upload.md') };

	const acceptance = applyPlanningResult({ runtime: fixture.runtime, result: proposal });

	await expect(acceptance).rejects.toThrow('A phase move needs one unoccupied target and replacement bytes');
	const after = await readPlanningSnapshot(fixture);
	expect(after?.digest).toBe(fixture.before.digest);
	expect(after?.artifacts).toEqual(fixture.before.artifacts);
	expect(after?.record.artifacts.find(({ phaseId }) => phaseId === 'A')?.path).toBe('phase1-original.md');
});
