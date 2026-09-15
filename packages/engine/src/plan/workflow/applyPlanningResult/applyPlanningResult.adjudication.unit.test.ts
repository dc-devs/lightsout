import { expect, test } from '@jest/globals';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { applyPlanningResult, readPlanningSnapshot } from '#src/plan/index.ts';
import { planningDataArtifact } from '#src/plan/workflow/store/index.ts';
import { planningRoleProposalFixture } from '#tests/helpers/planningRoleProposalFixture.ts';
import { planningWorkflowFinding } from '#tests/helpers/planningWorkflowScenarios.ts';

const setup = async ({ variant = 'repair' }: { variant?: string } = {}) =>
	planningRoleProposalFixture({
		role: PlanningVocabulary.Role.Adjudicate,
		arrange: ({ record, artifacts, work }) => {
			const source = record.sources[0];
			const finding = planningWorkflowFinding({ id: 'disputed', scope: work.scope });
			if (variant === 'user-repair') finding.owner = PlanningVocabulary.Owner.User;
			record.findings.push(finding);
			if (variant === 'missing-request') return;
			const request = {
				workId: work.id,
				request: {
					findingIds: ['disputed'],
					reason: PlanningVocabulary.Dispute.ConflictingReports,
					explanation: 'The two proposed retry behaviors conflict with the captured original obligation.',
					citations: [{ artifact: `planning-originals/${source.sha256}.txt`, sha256: source.sha256, quote: source.text }],
				},
			};
			const path = `planning-adjudication-requests/${sha256({ content: work.id })}.json`;
			const content = canonicalJson({ value: request });
			artifacts.set(path, content);
			record.artifacts.push(planningDataArtifact({ path, content }));
		},
		respond: ({ response, snapshot }) => {
			if (response.role !== PlanningVocabulary.Role.Adjudicate || response.kind !== PlanningVocabulary.ResultKind.Terminal)
				throw new Error('Expected adjudication');
			const source = snapshot.record.sources[0];
			const citation = { artifact: `planning-originals/${source.sha256}.txt`, sha256: source.sha256, quote: source.text };
			if (variant === 'stale-citation') citation.sha256 = 'b'.repeat(64);
			if (variant === 'invented-quote') citation.quote = 'Unobserved replacement permission';
			if (variant === 'unobserved-file') citation.artifact = 'unobserved.ts';
			const disposition = {
				findingIds: variant === 'unknown-finding' ? ['invented'] : ['disputed'],
				outcome:
					variant === 'withdraw' || variant === 'withdraw-without-evidence'
						? PlanningVocabulary.Disposition.Withdraw
						: variant === 'escalate'
							? PlanningVocabulary.Disposition.Escalate
							: PlanningVocabulary.Disposition.Repair,
				reason: 'Preserve completed uploads according to the original source.',
				citations: variant === 'withdraw-without-evidence' ? [] : [citation],
			};
			return { ...response, dispositions: variant === 'omitted-finding' ? [] : variant === 'duplicate-finding' ? [disposition, disposition] : [disposition] };
		},
	});

test.each(['repair', 'withdraw', 'escalate'])('applies an evidenced dispute disposition without granting verification: %s', async (variant) => {
	const fixture = await setup({ variant });

	const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });

	expect(result.accepted).toBe(true);
	expect(result.snapshot.record.findings.find((finding) => finding.id === 'disputed')).toEqual(
		expect.objectContaining({
			state: variant === 'withdraw' ? 'withdrawn' : 'open',
			owner: variant === 'escalate' ? 'user' : 'planner',
			verificationReceiptIds: [],
			proposedResolution: 'Preserve completed uploads according to the original source.',
		}),
	);
	expect(result.snapshot.record.work.some((work) => work.role === 'repair')).toBe(variant === 'repair');
	expect(result.snapshot.record.reviewReceipts).toStrictEqual(fixture.before.record.reviewReceipts);
});

test.each([
	['missing-request', /explicit assigned dispute/],
	['omitted-finding', /explicit assigned dispute/],
	['unknown-finding', /explicit assigned dispute/],
	['duplicate-finding', /explicit assigned dispute/],
	['withdraw-without-evidence', /Withdrawal requires evidence/],
	['user-repair', /user-owned conflict/],
	['stale-citation', /citation/i],
	['invented-quote', /citation/i],
	['unobserved-file', /citation/i],
])('rejects unsupported adjudication atomically: %s', async (variant, message) => {
	const fixture = await setup({ variant: String(variant) });

	await expect(applyPlanningResult({ runtime: fixture.runtime, result: fixture.result })).rejects.toThrow(message);

	expect((await readPlanningSnapshot(fixture))?.digest).toBe(fixture.before.digest);
});
