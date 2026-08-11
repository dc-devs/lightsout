import { describe, expect, test } from '@jest/globals';
import { readCallBlocks } from './readCallBlocks.ts';

/**
 * Every source below is a string rather than a fixture file: this reads test
 * files as TEXT, so the shapes it must handle — an unterminated call, a brace
 * inside a string, a commented-out suite — are ones a real file in this repo
 * could not hold without being a violation of the very rules it serves.
 */

/** One describe holding one test — the nesting the depth field exists to report. */
const setupSuite = () => ({
	text: ["describe('getAvatarUrl', () => {", "  test('returns null', () => {", '    const avatarUrl = null;', '  });', '});'].join('\n'),
});

/** A callee name sitting inside a longer identifier, above a real call. */
const setupShadowedName = () => ({
	text: ["xdescribe('skipped', () => {});", "describe('kept', () => {});"].join('\n'),
});

/** A dotted callee whose callback returns an object instead of opening a block. */
const setupModuleMock = () => ({
	text: ["jest.mock('@/utils/get-profile', () => ({", '  getProfile: (params: { userId: string }) => mockGetProfile(params),', '}));'].join('\n'),
});

/** A call in a comment, a call in a string, and a brace in a string. */
const setupInertText = () => ({
	text: ["// describe('ghost', () => {});", 'const label = "describe(\'quoted\', () => {})";', "describe('real', () => {", "  const brace = '}';", '});'].join(
		'\n',
	),
});

/** A matcher: a call with arguments but no callback at all. */
const setupMatcher = () => ({
	text: 'expect(profile).toStrictEqual(expect.any(String));',
});

/** A suite whose closing bracket the file never supplies. */
const setupUnterminated = () => ({
	text: ["describe('unbalanced', () => {", '  const value = 1;'].join('\n'),
});

/** A hook above a suite, so document order and callee order disagree. */
const setupHookAboveSuite = () => ({
	text: ['beforeEach(() => {', '  resetProfile();', '});', '', "describe('subject', () => {", '  const value = 1;', '});'].join('\n'),
});

/** A backtick title, behind whitespace between the callee and its parenthesis. */
const setupTemplateTitle = () => ({
	text: ['test  (`renders a card`, () => {', '  const value = 1;', '});'].join('\n'),
});

/** A multi-line block comment holding a call and an unclosed brace, above a real suite. */
const setupBlockComment = () => ({
	text: ['/*', " * describe('ghost', () => {", ' */', "describe('real', () => {", '  const value = 1;', '});'].join('\n'),
});

/** A callback whose destructured parameter defaults to an arrow of its own. */
const setupNestedArrowParam = () => ({
	text: ["test('renders', ({ buildProfile = () => ({}) }) => {", '  const value = 1;', '});'].join('\n'),
});

/** Two tests side by side in one suite — neither encloses the other. */
const setupSiblingTests = () => ({
	text: [
		"describe('subject', () => {",
		"  test('first', () => {",
		'    const first = 1;',
		'  });',
		'',
		"  test('second', () => {",
		'    const second = 2;',
		'  });',
		'});',
	].join('\n'),
});

describe('readCallBlocks', () => {
	test('reports each call with its title, body, line span and nesting depth', () => {
		const { text } = setupSuite();

		const blocks = readCallBlocks({ text, callees: ['describe', 'test'] });

		expect(blocks).toStrictEqual([
			{
				callee: 'describe',
				title: 'getAvatarUrl',
				body: "\n  test('returns null', () => {\n    const avatarUrl = null;\n  });\n",
				startLine: 1,
				endLine: 5,
				depth: 0,
			},
			{
				callee: 'test',
				title: 'returns null',
				body: '\n    const avatarUrl = null;\n  ',
				startLine: 2,
				endLine: 4,
				depth: 1,
			},
		]);
	});

	test('matches a callee only as a whole name, never inside a longer identifier', () => {
		const { text } = setupShadowedName();

		const blocks = readCallBlocks({ text, callees: ['describe'] });

		// xdescribe on line 1 is a different function, and an empty callback is still a block
		expect(blocks).toStrictEqual([{ callee: 'describe', title: 'kept', body: '', startLine: 2, endLine: 2, depth: 0 }]);
	});

	test('matches a dotted callee whole and reports an expression-bodied callback as its whole tail', () => {
		const { text } = setupModuleMock();

		const blocks = readCallBlocks({ text, callees: ['jest.mock'] });

		// no braces open after the arrow, so the returned object IS the body
		expect(blocks).toStrictEqual([
			{
				callee: 'jest.mock',
				title: '@/utils/get-profile',
				body: ' ({\n  getProfile: (params: { userId: string }) => mockGetProfile(params),\n})',
				startLine: 1,
				endLine: 3,
				depth: 0,
			},
		]);
	});

	test('sees no call inside a comment or a string, and no closing brace inside one either', () => {
		const { text } = setupInertText();

		const blocks = readCallBlocks({ text, callees: ['describe'] });

		// the body still reads the real text: only the bracket matching works off the mask
		expect(blocks).toStrictEqual([{ callee: 'describe', title: 'real', body: "\n  const brace = '}';\n", startLine: 3, endLine: 5, depth: 0 }]);
	});

	test('reports a call with no callback as its whole argument text, with no title', () => {
		const { text } = setupMatcher();

		const blocks = readCallBlocks({ text, callees: ['toStrictEqual'] });

		expect(blocks).toStrictEqual([{ callee: 'toStrictEqual', title: '', body: 'expect.any(String)', startLine: 1, endLine: 1, depth: 0 }]);
	});

	test('fails open on an unterminated call, ending the block at the last line of the file', () => {
		const { text } = setupUnterminated();

		const blocks = readCallBlocks({ text, callees: ['describe'] });

		expect(blocks).toStrictEqual([{ callee: 'describe', title: 'unbalanced', body: '\n  const value = 1;', startLine: 1, endLine: 2, depth: 0 }]);
	});

	test('returns blocks in document order however the callees were listed', () => {
		const { text } = setupHookAboveSuite();

		const blocks = readCallBlocks({ text, callees: ['describe', 'beforeEach'] });

		// 'describe' is scanned first but its block starts on line 5
		expect(blocks.map((block) => ({ callee: block.callee, startLine: block.startLine }))).toStrictEqual([
			{ callee: 'beforeEach', startLine: 1 },
			{ callee: 'describe', startLine: 5 },
		]);
	});

	test('reads a template-literal title through whitespace before the parenthesis', () => {
		const { text } = setupTemplateTitle();

		const blocks = readCallBlocks({ text, callees: ['test'] });

		expect(blocks).toStrictEqual([{ callee: 'test', title: 'renders a card', body: '\n  const value = 1;\n', startLine: 1, endLine: 3, depth: 0 }]);
	});

	test('sees no call inside a block comment, and still counts its lines', () => {
		const { text } = setupBlockComment();

		const blocks = readCallBlocks({ text, callees: ['describe'] });

		// the comment's own brace never opens a block, and its three lines still push the real suite to line 4
		expect(blocks).toStrictEqual([{ callee: 'describe', title: 'real', body: '\n  const value = 1;\n', startLine: 4, endLine: 6, depth: 0 }]);
	});

	test('takes the callback arrow outside every bracket, not an arrow inside its parameters', () => {
		const { text } = setupNestedArrowParam();

		const blocks = readCallBlocks({ text, callees: ['test'] });

		// the default value's arrow sits inside the parameter list, so the body starts after the outer one
		expect(blocks).toStrictEqual([{ callee: 'test', title: 'renders', body: '\n  const value = 1;\n', startLine: 1, endLine: 3, depth: 0 }]);
	});

	test('counts only enclosing blocks as depth, so sibling calls sit at the same level', () => {
		const { text } = setupSiblingTests();

		const blocks = readCallBlocks({ text, callees: ['describe', 'test'] });

		expect(blocks.map((block) => ({ title: block.title, depth: block.depth }))).toStrictEqual([
			{ title: 'subject', depth: 0 },
			{ title: 'first', depth: 1 },
			{ title: 'second', depth: 1 },
		]);
	});
});
