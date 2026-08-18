import { describe, expect, test } from '@jest/globals';
import { scanPlaceholders } from '@/plan/scanPlaceholders';

describe('scanPlaceholders', () => {
	test('each marker is reported once, on the first line it appears', () => {
		const lines = ['Do TBD here.', 'Still TBD below.', 'And ??? too.'];

		expect(scanPlaceholders({ lines })).toStrictEqual([
			{ label: 'TBD', line: 1 },
			{ label: '???', line: 3 },
		]);
	});

	test('a template-literal interpolation inside a fenced block is not a placeholder', () => {
		expect(scanPlaceholders({ lines: ['```ts', 'const greeting = `hi ${userName}`;', '```'] })).toStrictEqual([]);
	});

	test('a template-literal interpolation in prose is not a placeholder — the lookbehind covers it outside fences', () => {
		expect(scanPlaceholders({ lines: ['The writer interpolates `hi ${userName}` into the greeting.'] })).toStrictEqual([]);
	});

	test('destructuring inside a fenced block is not a placeholder', () => {
		expect(scanPlaceholders({ lines: ['```tsx', 'const {userName} = props;', '', 'return <span>{userName}</span>;', '```'] })).toStrictEqual([]);
	});

	test('a bare brace-token in prose is still flagged', () => {
		expect(scanPlaceholders({ lines: ['Resolve the {token} before writing.'] })).toStrictEqual([{ label: 'unresolved {token}', line: 1 }]);
	});

	test('a brace-token in an inline code span is still flagged — fences only, never spans', () => {
		expect(scanPlaceholders({ lines: ['Place it at `packages/{package}/src/thing.ts`.'] })).toStrictEqual([{ label: 'unresolved {token}', line: 1 }]);
	});

	test('a TODO inside a fenced block is still flagged — fences suppress only the brace-token', () => {
		expect(scanPlaceholders({ lines: ['```ts', '// TODO: decide later', '```'] })).toStrictEqual([{ label: 'TODO', line: 2 }]);
	});
});
