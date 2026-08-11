import { describe, expect, test } from '@jest/globals';
import { scanTestLines } from './scanTestLines.ts';

/** The mock-prefix rule's own pattern — a `const` at column 0 whose value is a `jest.fn`. */
const moduleScopeMock = /^const\s+([A-Za-z0-9_$]+)\s*=\s*jest\.fn\b/;

/** The shared-`let` rule's own pattern — a `let` at any indentation. */
const letDeclaration = /^\s*let\s+([A-Za-z0-9_$]+)/;

/** A pattern whose capture group can match nothing, so the scan sees a declaration with an empty name. */
const optionalName = /^let\s*([A-Za-z0-9_$]*)/;

/** A pattern with no capture group at all — a line matches, but nothing is declared by it. */
const noCaptureGroup = /^const\s+[A-Za-z0-9_$]+\s*=\s*jest\.fn\b/;

const setupFile = ({ lines }: { lines: string[] }) => ({ text: lines.join('\n') });

describe('scanTestLines', () => {
	test('reports each matching line as the name it declares and its 1-based line number', () => {
		const { text } = setupFile({
			lines: [
				"import { jest } from '@jest/globals';",
				'',
				'const mockGetProfile = jest.fn<(params: { userId: string }) => string>();',
				'',
				'const getAvatar = jest.fn();',
			],
		});

		const declared = scanTestLines({ text, pattern: moduleScopeMock });

		expect(declared).toStrictEqual([
			{ name: 'mockGetProfile', line: 3 },
			{ name: 'getAvatar', line: 5 },
		]);
	});

	test('reports a declaration at the line it sits on however deeply it is indented', () => {
		const { text } = setupFile({ lines: ["describe('subject', () => {", '\tlet subject;', '', '\t\tlet nested;', '});'] });

		const declared = scanTestLines({ text, pattern: letDeclaration });

		expect(declared).toStrictEqual([
			{ name: 'subject', line: 2 },
			{ name: 'nested', line: 4 },
		]);
	});

	test('returns nothing when no line matches the pattern', () => {
		const { text } = setupFile({ lines: ['const setup = () => ({ subject: 1 });', 'const other = 2;'] });

		const declared = scanTestLines({ text, pattern: moduleScopeMock });

		expect(declared).toStrictEqual([]);
	});

	test('skips a matching line whose captured name is empty', () => {
		const { text } = setupFile({ lines: ['let ', 'let subject;'] });

		const declared = scanTestLines({ text, pattern: optionalName });

		expect(declared).toStrictEqual([{ name: 'subject', line: 2 }]);
	});

	test('skips a matching line when the pattern captures no group', () => {
		const { text } = setupFile({ lines: ['const mockGetProfile = jest.fn();'] });

		const declared = scanTestLines({ text, pattern: noCaptureGroup });

		expect(declared).toStrictEqual([]);
	});

	test('returns nothing for empty text', () => {
		const declared = scanTestLines({ text: '', pattern: letDeclaration });

		expect(declared).toStrictEqual([]);
	});
});
