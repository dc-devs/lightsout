import { describe, expect, test } from '@jest/globals';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import { setupCloneSpansInput } from '#src/index.ts';

describe('setupCloneSpansInput', () => {
	test('builds the arm a clone-spans check narrows to', () => {
		expect(setupCloneSpansInput().kind).toBe(StandardsInputKind.CloneSpans);
	});

	test('carries the spans the engine detector would have found', () => {
		const span = { files: [{ path: 'src/a.ts', startLine: 1, endLine: 9 }], tokens: 60 };

		expect(setupCloneSpansInput({ spans: [span] })).toMatchObject({ spans: [span] });
	});

	test('with no spans, it is a run that found no duplication', () => {
		expect(setupCloneSpansInput()).toMatchObject({ spans: [] });
	});
});
