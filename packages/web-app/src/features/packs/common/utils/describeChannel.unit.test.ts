import { describe, expect, test } from '@jest/globals';
import { Framework } from '#src/common/constants/Framework.ts';
import { describeChannel } from '#src/features/packs/common/utils/describeChannel.ts';

describe('describeChannel', () => {
	test('shows the base rules as TypeScript, always on', () => {
		expect(describeChannel({ channel: 'base' })).toStrictEqual({ name: 'TypeScript', framework: Framework.TypeScript, activation: 'Always on' });
	});

	test('shows a framework’s rules as switching on with that framework', () => {
		expect(describeChannel({ channel: 'tanstack' })).toStrictEqual({ name: 'TanStack', framework: Framework.TanStack, activation: 'On with TanStack' });
	});

	test('names a channel of someone’s own from its id, with no logo to guess at', () => {
		expect(describeChannel({ channel: 'vue' })).toStrictEqual({ name: 'Vue', activation: 'On with Vue' });
	});
});
