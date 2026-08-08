import { StandardsRule, type StandardsFinding } from '@/contracts';
import type { CallBlock } from '@/standardsCheck/common/types/CallBlock';
import { buildFinding } from '@/standardsCheck/common/utils/buildFinding';
import { buildHookFinding } from '@/standardsCheck/common/utils/buildHookFinding';
import { buildLineSites } from '@/standardsCheck/common/utils/buildLineSites';
import { getLineNumber } from '@/standardsCheck/common/utils/getLineNumber';
import { readCallBlocks } from '@/standardsCheck/common/utils/readCallBlocks';

/** A module-scope mock declaration: a `const` whose line starts at column 0, so no block encloses it. */
const moduleScopeMock = /^const\s+([A-Za-z0-9_$]+)\s*=\s*jest\.fn\b/;

/** The four return-value setters unit-testing.md names. The `*Once` variants are deliberately absent — the doc does not name them. */
const returnSetter = /\.mock(?:ReturnValue|ResolvedValue|RejectedValue|Implementation)\s*\(/;

/** `jest.fn` with the character that decides whether it carries a generic: `<` typed, `(` untyped. */
const spyCall = /jest\.fn\s*([<(])/g;

/** The framework-generic carve-out at unit-testing.md line 156 — a stub cast loosely to satisfy a library's own result type. */
const frameworkCast = /as unknown as|as Record</;

/** The legacy wrapper the doc names outright: a factory forward typed to discard its arguments. */
const discardingWrapper = /\(\s*\.\.\.\s*[A-Za-z0-9_$]+\s*:\s*unknown\s*\[\s*\]/;

/** `<property>: () => mockThing()` — a forward that takes no arguments at all. */
const zeroArgWrapper = /([A-Za-z0-9_$]+)\s*:\s*\(\s*\)\s*=>\s*(mock[A-Za-z0-9_$]*)\s*\(/g;

/** The manual cleanup a Jest config's `clearMocks`/`restoreMocks` already performs. */
const manualCleanup = /jest\.(?:clearAllMocks|resetAllMocks|restoreAllMocks)\s*\(|\.mock(?:Clear|Reset)\s*\(/;

// `test-mock-prefix`. Only a declaration at column 0 is judged: the doc's reason
// is Jest hoisting `jest.mock()` above module variables, and a factory-local
// `jest.fn()` is never hoisted — line 191 recommends exactly that, so an
// indented declaration is out of scope rather than forgiven.
const mockPrefixFinding = ({ file, text }: { file: string; text: string }) => {
	const unprefixed: Array<{ name: string; line: number }> = [];

	text.split('\n').forEach((line, index) => {
		const name = line.match(moduleScopeMock)?.[1] ?? '';

		if (name !== '' && !name.startsWith('mock')) {
			unprefixed.push({ name, line: index + 1 });
		}
	});

	return unprefixed.length === 0
		? undefined
		: buildFinding({
				rule: StandardsRule.TestMockPrefix,
				files: buildLineSites({ file, spans: unprefixed.map(({ line }) => ({ startLine: line, endLine: line })) }),
				detail: `${unprefixed.map(({ name, line }) => `'${name}' (line ${line})`).join(', ')} declared at module scope without a 'mock' prefix`,
				guidance: 'Jest hoists `jest.mock()` above module variables — only `mock`-prefixed names are reachable inside the factory.',
			});
};

// `test-mock-untyped`. The statement, not the line, carries the carve-out: a
// stub cast for a framework generic routinely spreads its `as unknown as`
// several lines below the `jest.fn()` it wraps.
const untypedSpyFinding = ({ file, text }: { file: string; text: string }) => {
	const terminated = `${text};`;
	const lines: number[] = [];

	for (const match of text.matchAll(spyCall)) {
		const statement = terminated.slice(terminated.lastIndexOf(';', match.index) + 1, terminated.indexOf(';', match.index));

		if (match[1] === '(' && !frameworkCast.test(statement)) {
			lines.push(getLineNumber({ text, index: match.index }));
		}
	}

	return lines.length === 0
		? undefined
		: buildFinding({
				rule: StandardsRule.TestMockUntyped,
				files: buildLineSites({ file, spans: lines.map((line) => ({ startLine: line, endLine: line })) }),
				detail: `jest.fn() with no generic at line(s) ${lines.join(', ')}`,
				guidance: 'Type every `jest.fn()` to the real signature — read the source first, and include the Promise wrapper for an async one.',
			});
};

// `test-mock-wrapper-untyped`. A discarding wrapper is legacy debt the doc names
// outright. A zero-argument forward needs evidence — the file's own
// `toHaveBeenCalledWith` on that mock proves the function takes arguments, and
// without it there is no violation to report.
const wrapperFinding = ({ file, text }: { file: string; text: string }) => {
	const wrappers: Array<{ block: CallBlock; reasons: string[] }> = [];

	for (const block of readCallBlocks({ text, callees: ['jest.mock'] })) {
		const reasons: string[] = discardingWrapper.test(block.body) ? ['a `(...args: unknown[])` wrapper'] : [];

		for (const forward of block.body.matchAll(zeroArgWrapper)) {
			if (new RegExp(`expect\\(\\s*${forward[2]}\\s*\\)[^;]*toHaveBeenCalledWith`).test(text)) {
				reasons.push(`'${forward[1]}' forwards no arguments to ${forward[2]}`);
			}
		}

		if (reasons.length > 0) {
			wrappers.push({ block, reasons });
		}
	}

	return wrappers.length === 0
		? undefined
		: buildFinding({
				rule: StandardsRule.TestMockWrapperUntyped,
				files: buildLineSites({ file, spans: wrappers.map(({ block }) => block) }),
				detail: wrappers.map(({ block, reasons }) => `${reasons.join('; ')} (line ${block.startLine})`).join(', '),
				guidance: 'Type the factory wrapper to the real parameters — a discarded argument makes `toHaveBeenCalledWith` fail on a call that was correct.',
			});
};

interface Params {
	/** Repo-relative test file path — the finding's site. */
	file: string;
	text: string;
}

/**
 * The five mock rules of standards/tests/unit/jest/unit-testing.md for one test
 * file: how mock variables are named, where their return values are set, how
 * `jest.fn()` and its factory wrappers are typed, and whether the file cleans
 * up by hand what the Jest config already clears.
 *
 * Every rule reads text, never a parse tree, so the group survives on a JS-only
 * repo. The cost is honest and bounded: a `jest.fn(` written inside a string
 * literal reads as a real call (the same limit `checkFileExports` documents for
 * `export const` inside a template), and a mock built by a helper rather than a
 * literal `jest.fn` is invisible.
 *
 * A module internal — its behaviour is pinned through `checkTestShape`, the
 * public surface these rules reach a caller through.
 */
export const checkTestMockRules = ({ file, text }: Params): StandardsFinding[] => {
	const hookBlocks = readCallBlocks({ text, callees: ['beforeEach', 'beforeAll', 'afterEach', 'afterAll'] });
	const beforeEachBlocks = hookBlocks.filter((block) => block.callee === 'beforeEach');

	return [
		mockPrefixFinding({ file, text }),
		// `test-mock-return-in-hook`. `beforeEach` only, the single hook line 136
		// names — and the sanctioned home for a return value is the `setup()`
		// factory, which is not a hook at all.
		buildHookFinding({
			file,
			blocks: beforeEachBlocks,
			rule: StandardsRule.TestMockReturnInHook,
			pattern: returnSetter,
			detailSuffix: 'sets a mock return value',
			guidance: 'Set mock return values in the `setup()` factory, so each test states its own arrangement.',
		}),
		untypedSpyFinding({ file, text }),
		wrapperFinding({ file, text }),
		// `test-manual-mock-cleanup`. Hook bodies only, which is what makes line
		// 192's fallback structural: the same `.mockReset()` at the top of a
		// `setup()` factory is the doc's own advice and never reaches this rule.
		buildHookFinding({
			file,
			blocks: hookBlocks,
			rule: StandardsRule.TestManualMockCleanup,
			pattern: manualCleanup,
			detailSuffix: 'clears mocks by hand',
			guidance: "Mock cleanup belongs in the package's Jest config (`clearMocks`, `restoreMocks`), not in a per-file hook.",
		}),
	].filter((finding): finding is StandardsFinding => finding !== undefined);
};
