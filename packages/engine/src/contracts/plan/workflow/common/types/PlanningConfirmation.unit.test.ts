import { expect, test } from '@jest/globals';
import { PlanningConfirmation } from '#src/contracts/index.ts';

const setup = () => ({
	id: 'approval',
	channel: 'foreground',
	messageId: 'actual-message',
	messageText: 'Approve the challenged design and delegate implementation details.',
	approvedDigest: 'a'.repeat(64),
	delegation: { kind: 'whole-plan', claimIds: [], phaseIds: [], packageRoots: [] },
	alignment: { sourceDigest: 'b'.repeat(64), semanticDigest: 'c'.repeat(64), challengeReceiptId: 'independent-challenge' },
});

test('retains exact explicit alignment authority without inventing it for ordinary answers', () => {
	const input = setup();
	const { alignment: _alignment, ...ordinary } = input;
	const result = { approval: PlanningConfirmation.parse(input), ordinary: PlanningConfirmation.parse(ordinary) };
	expect(result).toStrictEqual({ approval: input, ordinary });
	expect(Object.hasOwn(result.ordinary, 'alignment')).toBe(false);
});

test.each([{ sourceDigest: 'bad' }, { semanticDigest: 'bad' }, { challengeReceiptId: '' }, { approved: true }])(
	'rejects malformed or invented alignment authority: %j',
	(patch) => {
		const input = setup();
		const result = PlanningConfirmation.safeParse({ ...input, alignment: { ...input.alignment, ...patch } });
		expect(result.success).toBe(false);
	},
);
