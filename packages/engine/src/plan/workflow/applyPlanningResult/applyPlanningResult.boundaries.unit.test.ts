import { expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { applyPlanningResult, readPlanningSnapshot } from '#src/plan/index.ts';
import { planningArchitectProposalFixture } from '#tests/helpers/planningArchitectProposalFixture.ts';
import { planningRoleProposalFixture } from '#tests/helpers/planningRoleProposalFixture.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

test('accepts explicitly undefined optional repair collections as omitted values', async () => {
	const fixture = await planningRoleProposalFixture({ role: PlanningVocabulary.Role.Repair });
	if (fixture.result.kind !== 'terminal' || fixture.result.role !== 'repair') throw new Error('Expected repair proposal');
	const result = await applyPlanningResult({
		runtime: fixture.runtime,
		result: { ...fixture.result, artifactLayouts: undefined, adjudicationRequests: undefined },
	});
	expect(result.accepted).toBe(true);
	expect(result.snapshot.record.work.find((work) => work.id === fixture.work.id)?.status).toBe('complete');
	expect(result.snapshot.artifacts.get('plan.md')).toBe(fixture.result.artifactEdits[0].content);
	expect(result.snapshot.record.work.some((work) => work.role === 'adjudicate')).toBe(false);
});

test('rejects a semantic proposal with an unresolved dependency before publishing any result', async () => {
	const fixture = await planningArchitectProposalFixture({
		respond: async ({ response }) => {
			if (response.kind === 'terminal' && response.role === 'architect') response.claims[0].dependencies = ['unresolved-contract'];
			return response;
		},
	});
	const before = await readPlanningSnapshot(fixture);
	await expect(applyPlanningResult({ runtime: fixture.runtime, result: fixture.result })).rejects.toThrow(
		'Planning context requires unresolved dependency unresolved-contract',
	);
	expect((await readPlanningSnapshot(fixture))?.digest).toBe(before?.digest);
});

test('rejects an evidence request at the completion boundary without granting a receipt', async () => {
	const fixture = await planningArchitectProposalFixture();
	const before = await readPlanningSnapshot(fixture);
	const { role, workId, attemptId, inputDigest, invocationId, packetDigest } = fixture.result;
	await expect(
		applyPlanningResult({
			runtime: fixture.runtime,
			result: {
				kind: 'evidence-request',
				role,
				workId,
				attemptId,
				inputDigest,
				invocationId,
				packetDigest,
				requests: [{ requestId: 'actual-source', operation: 'read-file', path: 'package.json', reason: 'Read the remaining dependency' }],
			},
		}),
	).rejects.toThrow('Evidence requests cannot complete planning work');
	expect((await readPlanningSnapshot(fixture))?.digest).toBe(before?.digest);
});

test('refuses a completion proposal before the receiving workflow has captured input', async () => {
	const authored = await planningArchitectProposalFixture();
	const receiver = await planningWorkflowFixture();
	await expect(applyPlanningResult({ runtime: receiver.runtime, result: authored.result })).rejects.toThrow('Planning input must be captured');
	expect(await readPlanningSnapshot(receiver)).toBeUndefined();
	expect(receiver.calls).toHaveLength(0);
});
