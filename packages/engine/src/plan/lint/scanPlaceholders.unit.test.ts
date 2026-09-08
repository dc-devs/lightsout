import { describe, expect, test } from '@jest/globals';
import { scanPlaceholders } from '#src/plan/lint/scanPlaceholders.ts';

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

	test('scanPlaceholders: a marker inside the skipped range is passed over and the next one outside it is still found', () => {
		const lines = ['## Decision Log', 'We rejected the TBD approach.', '', '## Files to Create', 'The name is TBD.'];

		expect(scanPlaceholders({ lines, skipRange: { start: 1, end: 3 } })).toStrictEqual([{ label: 'TBD', line: 5 }]);
	});

	test('scanPlaceholders: no skip range leaves every line scanned', () => {
		const lines = ['## Decision Log', 'We rejected the TBD approach.', '', '## Files to Create', 'The name is TBD.'];

		expect(scanPlaceholders({ lines })).toStrictEqual([{ label: 'TBD', line: 2 }]);
	});

	test('fence state is tracked across the skipped range — a fence closing inside it still closes', () => {
		const lines = ['```ts', 'const {inside} = props;', '```', 'Resolve the {token} before writing.'];

		// the closing fence sits on line 3, inside the skipped range: were the range
		// dropped before the fence was read, the scan would still believe itself
		// inside a code block and swallow the real brace-token on line 4
		expect(scanPlaceholders({ lines, skipRange: { start: 2, end: 3 } })).toStrictEqual([{ label: 'unresolved {token}', line: 4 }]);
	});
});
