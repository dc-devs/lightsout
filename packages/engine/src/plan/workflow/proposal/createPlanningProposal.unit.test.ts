import { describe, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { PlanningProposalPosition } from '#src/plan/workflow/common/constants/PlanningProposalPosition.ts';
import { createPlanningProposal } from '#src/plan/workflow/proposal/index.ts';
import { planningStoreFixture } from '#tests/helpers/planningStoreFixture.ts';

const setup = async () => {
	const fixture = await planningStoreFixture();
	const snapshot = { record: fixture.record, artifacts: fixture.artifacts, digest: '0'.repeat(64) };
	snapshot.record.claims.push({
		...snapshot.record.claims[0],
		id: 'retry-contract',
		kind: PlanningVocabulary.ClaimKind.Contract,
		owner: PlanningVocabulary.Owner.Planner,
		confirmationId: undefined,
		contract: {
			signatures: ['retry(id): Completion'],
			ordering: ['Read completion before enqueue'],
			failures: ['Retain completed uploads'],
			boundaries: ['Never enqueue completed uploads'],
		},
	});
	snapshot.record.artifacts[0].scopeText = 'Retry only';
	snapshot.record.artifacts[0].exports = ['retry'];
	return { snapshot, original: structuredClone(snapshot) };
};

describe('createPlanningProposal', () => {
	test('shows structured contracts and phase metadata before the user approves them', async () => {
		const { snapshot } = await setup();

		const original = createPlanningProposal({ snapshot, position: PlanningProposalPosition.BeforeDraft });

		expect(original.question.context).toContain('retry(id): Completion');
		expect(original.question.context).toContain('Read completion before enqueue');
		expect(original.question.context).toContain('Retain completed uploads');
		expect(original.question.context).toContain('Never enqueue completed uploads');
		expect(original.question.context).toContain('Retry only');
		expect(original.question.context).toContain('"exports":["retry"]');
	});

	test('preserves design approval across ordinary prose authoring', async () => {
		const { snapshot, original } = await setup();

		snapshot.artifacts.set('plan.md', 'Expanded implementation explanation');
		snapshot.record.artifacts[0].sha256 = sha256({ content: 'Expanded implementation explanation' });

		const proposals = [original, snapshot].map((value) => createPlanningProposal({ snapshot: value, position: PlanningProposalPosition.BeforeDraft }));

		expect(proposals[1].digest).toBe(proposals[0].digest);
	});

	test.each(['contract', 'scope', 'delegation', 'standards'])('requires renewed approval for changed %s even when sources are unchanged', async (change) => {
		const { snapshot, original } = await setup();

		if (change === 'contract') {
			const claim = snapshot.record.claims[1];
			if (claim.kind !== PlanningVocabulary.ClaimKind.Contract) throw new Error('Expected structured contract');
			claim.contract.ordering = ['Enqueue before reading completion'];
		}
		if (change === 'scope') snapshot.record.artifacts[0].scopeText = 'Rewrite upload storage';
		if (change === 'delegation') snapshot.record.confirmations[0].delegation.packageRoots = ['storage'];
		if (change === 'standards')
			snapshot.record.standards.push({
				channel: PlanningVocabulary.Channel.Code,
				sourceIdentity: 'test-pack',
				policyDigest: '2'.repeat(64),
				sha256: '1'.repeat(64),
				artifact: 'planning-standards.json',
			});

		const proposals = [original, snapshot].map((value) => createPlanningProposal({ snapshot: value, position: PlanningProposalPosition.BeforeDraft }));

		expect(proposals[1].digest).not.toBe(proposals[0].digest);
	});
});
