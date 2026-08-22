import { describe, expect, test } from '@jest/globals';
import { pathPairFromLine } from '#src/plan/common/paths/pathPairFromLine.ts';

describe('pathPairFromLine', () => {
	test('a well-formed move heading yields its source and destination in order', () => {
		const pair = pathPairFromLine({ line: '### `src/plan/old.ts` → `src/plan/common/new.ts`' });

		expect(pair).toStrictEqual({ from: 'src/plan/old.ts', to: 'src/plan/common/new.ts' });
	});

	test('a heading naming only one path yields nothing, so the caller reports it rather than parsing a half-move', () => {
		const pair = pathPairFromLine({ line: '### `src/plan/old.ts`' });

		// silently taking one path would lose the file the plan meant to move
		expect(pair).toBeUndefined();
	});

	test('a line with no backticked path at all yields nothing', () => {
		const pair = pathPairFromLine({ line: '### move the parser somewhere better' });

		expect(pair).toBeUndefined();
	});

	test('spans that are not path-shaped are skipped, so the pair is the first two that are', () => {
		const pair = pathPairFromLine({ line: '### `parsePlan` moves: `src/plan/old.ts` → `src/plan/new.ts`' });

		// a bare identifier has no `/` and no extension — it is a name, not a path
		expect(pair).toStrictEqual({ from: 'src/plan/old.ts', to: 'src/plan/new.ts' });
	});

	test('only the first two path-shaped spans are read — a third is ignored', () => {
		const pair = pathPairFromLine({ line: '### `a/one.ts` → `a/two.ts` (was `a/three.ts`)' });

		expect(pair).toStrictEqual({ from: 'a/one.ts', to: 'a/two.ts' });
	});

	test('a span holding a path followed by prose yields the leading token', () => {
		const pair = pathPairFromLine({ line: '### `src/old.ts the old one` → `src/new.ts the new one`' });

		expect(pair).toStrictEqual({ from: 'src/old.ts', to: 'src/new.ts' });
	});
});
