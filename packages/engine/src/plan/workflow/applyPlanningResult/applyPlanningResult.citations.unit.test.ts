import { expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { applyPlanningResult, readPlanningSnapshot } from '#src/plan/index.ts';
import { planningRoleProposalFixture } from '#tests/helpers/planningRoleProposalFixture.ts';
import { planningWorkflowFinding } from '#tests/helpers/planningWorkflowScenarios.ts';

const setup = async ({ variant }: { variant: string }) =>
	planningRoleProposalFixture({
		role: PlanningVocabulary.Role.DesignReview,
		evidenceRequests: [{ requestId: 'manifest', operation: 'read-file', path: 'package.json', reason: 'Inspect the actual repository manifest' }],
		respond: ({ response, snapshot }) => {
			if (response.kind !== 'terminal' || !('coverage' in response)) throw new Error('Expected independent review');
			const work = snapshot.record.work.find((work) => work.id === response.workId);
			if (!work) throw new Error('Expected review assignment');
			const finding = planningWorkflowFinding({ id: 'manifest-contract', scope: work.scope });
			finding.citations = [
				{
					artifact: variant === 'path' ? 'other-package.json' : 'package.json',
					sha256: variant === 'hash' ? 'a'.repeat(64) : sha256({ content: '{"name":"workflow-test"}' }),
					quote: 'workflow-test',
				},
			];
			return { ...response, findings: [finding], verifiedFindings: [] };
		},
	});

test('accepts an exact finding citation to source acquired through the engine evidence boundary', async () => {
	const fixture = await setup({ variant: 'current' });
	const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });
	expect(result.accepted).toBe(true);
	expect(result.snapshot.record.findings.at(-1)?.citations).toStrictEqual([
		{ artifact: 'package.json', sha256: sha256({ content: '{"name":"workflow-test"}' }), quote: 'workflow-test' },
	]);
	expect(result.snapshot.record.reviewReceipts.at(-1)?.dependencies).toContainEqual(expect.objectContaining({ kind: 'content', path: 'package.json' }));
	expect(fixture.calls.at(-1)?.prompt).toContain('workflow-test');
});

test.each(['path', 'hash'])('rejects a citation that does not identify the actual acquired source: %s', async (variant) => {
	const fixture = await setup({ variant });
	await expect(applyPlanningResult({ runtime: fixture.runtime, result: fixture.result })).rejects.toThrow('Citation is not backed by acquired evidence');
	expect((await readPlanningSnapshot(fixture))?.digest).toBe(fixture.before.digest);
});
