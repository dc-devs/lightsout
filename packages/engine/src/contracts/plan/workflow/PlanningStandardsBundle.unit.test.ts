import { expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningStandardsBundle, PlanningVocabulary } from '#src/contracts/index.ts';

const setup = () => {
	const text = 'Preserve every caller contract.';
	const digest = sha256({ content: text });
	return {
		format: 'planning-standards-v1',
		policyDigest: digest,
		observations: [{ path: '/declared/external/pack/rule.md', kind: PlanningVocabulary.Observation.Content, sha256: digest }],
		channels: [{ channel: PlanningVocabulary.Channel.Code, sourceIdentity: 'declared pack', policyDigest: digest, sha256: digest, text }],
	};
};
test('preserves exact standard text and externally located acquisition provenance', () => {
	const input = setup();

	const result = PlanningStandardsBundle.parse(input);

	expect(result).toStrictEqual(input);
});
const setupInvalid = ({ variant }: { variant: string }) => {
	const input = setup();
	switch (variant) {
		case 'duplicate channel':
			return { ...input, channels: [...input.channels, ...input.channels] };
		case 'missing observations': {
			const { observations: _observations, ...rest } = input;
			return rest;
		}
		case 'unknown channel':
			return { ...input, channels: [{ ...input.channels[0], channel: 'unrecognised' }] };
		case 'invented observation':
			return { ...input, observations: [{ ...input.observations[0], kind: 'assumed' }] };
		case 'invalid digest':
			return { ...input, policyDigest: 'not a hash' };
		default:
			return { ...input, ready: true };
	}
};
test.each(['duplicate channel', 'missing observations', 'unknown channel', 'invented observation', 'invalid digest', 'extra authority'])(
	'rejects $0 in portable standards',
	(variant) => {
		const input = setupInvalid({ variant });

		const result = PlanningStandardsBundle.safeParse(input);

		expect(result.success).toBe(false);
	},
);
