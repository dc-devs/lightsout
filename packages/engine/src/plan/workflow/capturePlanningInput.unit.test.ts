import { expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { capturePlanningInput } from '#src/plan/workflow/capturePlanningInput.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

const setup = async () => {
	const fixture = await planningWorkflowFixture();
	const original = fixture.input.claims[0];
	if (!original) throw new Error('Fixture requirement is absent');
	const text = 'Retain metadata for completed uploads';
	const origin = { artifact: 'metadata.md', locator: 'Requirement', text, sha256: sha256({ content: text }) };
	const dependent = { ...original, id: 'metadata', text, origin, dependencies: ['required'], confirmationId: 'metadata-approval' };
	fixture.input.sources.push(origin);
	fixture.input.claims.push(dependent);
	fixture.input.confirmations.push({
		...fixture.input.confirmations[0],
		id: 'metadata-approval',
		messageId: 'metadata-message',
		messageText: text,
		approvedDigest: origin.sha256,
	});
	await fixture.capture();
	const replacement = ({ id, supersedes, text }: { id: string; supersedes: string; text: string }) => {
		const origin = { artifact: `${id}.md`, locator: 'Replacement', text, sha256: sha256({ content: text }) };
		return {
			stage: fixture.runtime.stage,
			sources: [origin],
			claims: [{ ...original, id, supersedes, text, origin, confirmationId: `${id}-approval` }],
			confirmations: [
				{ ...fixture.input.confirmations[0], id: `${id}-approval`, messageId: `${id}-message`, messageText: text, approvedDigest: origin.sha256 },
			],
		};
	};
	return { ...fixture, original, dependent, replacement };
};

test('redirects confirmed dependents across explicit replacement chains while preserving approved historical meaning', async () => {
	const fixture = await setup();
	const second = fixture.replacement({ id: 'required-2', supersedes: 'required', text: 'Retain completed uploads across retries and restarts' });
	const third = fixture.replacement({ id: 'required-3', supersedes: 'required-2', text: 'Retain completed uploads across retries, restarts and recovery' });

	await capturePlanningInput({ runtime: fixture.runtime, input: second });
	const result = await capturePlanningInput({ runtime: fixture.runtime, input: third });

	expect(result.record.claims.find((claim) => claim.id === 'metadata')).toStrictEqual({ ...fixture.dependent, dependencies: ['required-3'] });
	expect(result.record.claims.find((claim) => claim.id === 'required')).toStrictEqual({ ...fixture.original, state: PlanningVocabulary.ClaimState.Superseded });
	expect(result.record.claims.find((claim) => claim.id === 'required-2')).toStrictEqual({
		...second.claims[0],
		state: PlanningVocabulary.ClaimState.Superseded,
	});
	expect(result.record.claims.find((claim) => claim.id === 'required-3')).toStrictEqual(third.claims[0]);
	expect(result.record.confirmations).toHaveLength(4);
	expect(result.artifacts.get(`planning-originals/${fixture.original.origin.sha256}.txt`)).toBe(fixture.original.text);
});
