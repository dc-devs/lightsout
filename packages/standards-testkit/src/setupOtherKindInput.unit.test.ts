import { describe, expect, test } from '@jest/globals';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import { setupOtherKindInput } from '#src/index.ts';

describe('setupOtherKindInput', () => {
	test('is a real arm of the union, so a check narrows it away rather than crashing on it', () => {
		// the guard every check opens with is unreachable in a real run — the engine
		// only hands a check the kind it asked for — so each rule proves it by hand
		expect(setupOtherKindInput().kind).toBe(StandardsInputKind.CloneSpans);
	});

	test('is complete enough to pass to a check untouched', () => {
		expect(setupOtherKindInput()).toStrictEqual({
			kind: StandardsInputKind.CloneSpans,
			cwd: '/repo',
			source: ['src/subject.ts'],
			spans: [],
		});
	});
});
