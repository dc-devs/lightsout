import { describe, expect, test } from '@jest/globals';
import { blankStringsAndComments } from './blankStringsAndComments.ts';

describe('blankStringsAndComments', () => {
	test('empties a single- and double-quoted string, leaving the quotes where they were', () => {
		expect(blankStringsAndComments({ text: "const a = 'jest.fn()';" })).toBe("const a = '         ';");
		expect(blankStringsAndComments({ text: 'const a = "jest.fn()";' })).toBe('const a = "         ";');
	});

	test('keeps every character position, so an offset taken from the result points at the same place', () => {
		const text = "const sample = 'jest.fn()';\nconst spy = jest.fn();\n";

		const blanked = blankStringsAndComments({ text });

		expect(blanked).toHaveLength(text.length);
		// the real call is still where it was; the quoted one is gone
		expect(blanked.indexOf('jest.fn(')).toBe(text.lastIndexOf('jest.fn('));
	});

	test('leaves newlines inside a blanked span, so later line numbers still count the same', () => {
		const text = '/*\n jest.fn()\n*/\nconst spy = jest.fn();';

		const blanked = blankStringsAndComments({ text });

		expect(blanked.split('\n')).toHaveLength(4);
		expect(blanked.split('\n')[3]).toBe('const spy = jest.fn();');
	});

	test('empties a line comment to the end of its line and no further', () => {
		expect(blankStringsAndComments({ text: 'const a = 1; // jest.fn()\nconst b = 2;' })).toBe('const a = 1;             \nconst b = 2;');
	});

	test('empties a block comment including its markers', () => {
		expect(blankStringsAndComments({ text: 'a /* jest.fn() */ b' })).toBe('a                 b');
	});

	test('empties a template literal but keeps the code inside an interpolation', () => {
		const text = 'const a = `jest.fn() ${jest.fn()} tail`;';

		const blanked = blankStringsAndComments({ text });

		// the quoted mention goes, the real call inside ${} stays
		expect(blanked).toBe('const a = `          ${jest.fn()}     `;');
	});

	test('tells the brace closing an interpolation from one closing an object inside it', () => {
		const text = 'const a = `x ${ fn({ k: 1 }) } y`;';

		expect(blankStringsAndComments({ text })).toBe('const a = `  ${ fn({ k: 1 }) }  `;');
	});

	test('handles a template nested inside an interpolation', () => {
		const text = 'const a = `x ${ `y ${ fn() } z` } w`;';

		expect(blankStringsAndComments({ text })).toBe('const a = `  ${ `  ${ fn() }  ` }  `;');
	});

	test('an escaped quote does not end the string early', () => {
		expect(blankStringsAndComments({ text: "const a = 'it\\'s jest.fn()';" })).toBe("const a = '               ';");
	});

	test('an unterminated string stops at the end of its line rather than eating the file', () => {
		const text = "const a = 'oops\nconst spy = jest.fn();";

		const blanked = blankStringsAndComments({ text });

		expect(blanked.split('\n')[1]).toBe('const spy = jest.fn();');
	});

	test('leaves ordinary code untouched', () => {
		const text = 'const spy = jest.fn<(id: string) => number>();';

		expect(blankStringsAndComments({ text })).toBe(text);
	});

	test('empties a regex literal, so an apostrophe inside one cannot open a phantom string', () => {
		// the live bug: /typo'd name/ read as code let the apostrophe swallow the
		// rest of the file, merging every later test block into one
		const text = "expect(a).toMatch(/typo'd name/);\nsetupThing();";

		expect(blankStringsAndComments({ text })).toBe('expect(a).toMatch(/           /);\nsetupThing();');
	});

	test('a slash after an identifier, call or index is division and stays', () => {
		for (const text of ['const x = a / b / c;', 'const y = f() / 2;', 'const z = arr[0] / n;']) {
			expect(blankStringsAndComments({ text })).toBe(text);
		}
	});

	test('a regex after return or an opening bracket is a regex, wherever a value is expected', () => {
		expect(blankStringsAndComments({ text: "return /it's/;" })).toBe('return /    /;');
		expect(blankStringsAndComments({ text: "f(/it's/)" })).toBe('f(/    /)');
	});

	test('an escaped slash or a character class does not end the regex early', () => {
		expect(blankStringsAndComments({ text: "const r = /a\\/b'c/; g();" })).toBe('const r = /      /; g();');
		expect(blankStringsAndComments({ text: "const r = /a[/]b'c/; g();" })).toBe('const r = /       /; g();');
	});

	test('a lone slash with no closing partner on its line is division, never a runaway blank', () => {
		const text = "const half = total / 2;\nconst s = 'kept';";

		expect(blankStringsAndComments({ text })).toBe("const half = total / 2;\nconst s = '    ';");
	});

	test('empty text stays empty', () => {
		expect(blankStringsAndComments({ text: '' })).toBe('');
	});

	test('a regex opening the very file is still a regex, with nothing before it to divide', () => {
		// nothing precedes the slash, so a value is expected and the apostrophe inside cannot open a string
		expect(blankStringsAndComments({ text: "/it's a regex/.test(name);" })).toBe('/            /.test(name);');
	});

	test('a slash where a value is expected but never closes is division, so the rest of the file survives', () => {
		const text = "return / 2;\nconst s = 'kept';";

		expect(blankStringsAndComments({ text })).toBe("return / 2;\nconst s = '    ';");
	});

	test('an escaped backtick does not end a template early, and the interpolation after it still holds code', () => {
		const text = 'const a = `a\\`b ${ fn() } c`;';

		expect(blankStringsAndComments({ text })).toBe('const a = `     ${ fn() }  `;');
	});

	test('an unterminated block comment is emptied to the end of the file rather than left as code', () => {
		const text = 'const a = 1;\n/* unclosed jest.fn()';

		expect(blankStringsAndComments({ text })).toBe('const a = 1;\n                     ');
	});
});
