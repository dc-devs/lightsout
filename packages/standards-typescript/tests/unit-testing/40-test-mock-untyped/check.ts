import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readTestFiles } from '../../../common/checkInput/readTestFiles.ts';
import { buildLineSites } from '../../../common/findings/buildLineSites.ts';
import { buildRawFinding } from '../../../common/findings/buildRawFinding.ts';
import { blankStringsAndComments } from '../../../common/parsing/blankStringsAndComments.ts';
import { getLineNumber } from '../../../common/parsing/getLineNumber.ts';

/** `jest.fn` with the character that decides whether it carries a generic: `<` typed, `(` untyped. */
const spyCall = /jest\.fn\s*([<(])/g;

/** The framework-generic carve-out this rule's prose grants — a stub cast loosely to satisfy a library's own result type. */
const frameworkCast = /as unknown as|as Record</;

// The statement, not the line, carries the carve-out: a stub cast for a
// framework generic routinely spreads its `as unknown as` several lines below
// the `jest.fn()` it wraps.
const untypedSpyFindings = ({ file, text }: { file: string; text: string }) => {
	// Read with strings, templates and comments emptied out: a test that passes
	// sample code in as data, and this rule's own message naming what it bans,
	// are mentions of `jest.fn()` rather than uses of it. Positions are
	// unchanged, so the lines reported are the file's own.
	const code = blankStringsAndComments({ text });
	const terminated = `${code};`;
	const lines: number[] = [];

	for (const match of code.matchAll(spyCall)) {
		const statement = terminated.slice(terminated.lastIndexOf(';', match.index) + 1, terminated.indexOf(';', match.index));

		if (match[1] === '(' && !frameworkCast.test(statement)) {
			lines.push(getLineNumber({ text: code, index: match.index }));
		}
	}

	return lines.length === 0
		? []
		: [
				buildRawFinding({
					rule: 'test-mock-untyped',
					files: buildLineSites({ file, spans: lines.map((line) => ({ startLine: line, endLine: line })) }),
					detail: `jest.fn() with no generic at line(s) ${lines.join(', ')}`,
					guidance: 'Type every `jest.fn()` to the real signature — read the source first, and include the Promise wrapper for an async one.',
				}),
			];
};

export const check: StandardsCheckModule = {
	inputKind: 'test-file',
	run: ({ input }): RawStandardsFinding[] => readTestFiles({ input }).flatMap(untypedSpyFindings),
};
