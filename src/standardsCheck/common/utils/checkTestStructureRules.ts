import { StandardsRule, type StandardsFinding } from '@/contracts';
import type { CallBlock } from '@/standardsCheck/common/types/CallBlock';
import { buildFinding } from '@/standardsCheck/common/utils/buildFinding';
import { buildHookFinding } from '@/standardsCheck/common/utils/buildHookFinding';
import { buildLineSites } from '@/standardsCheck/common/utils/buildLineSites';
import { getLineNumber } from '@/standardsCheck/common/utils/getLineNumber';
import { readCallBlocks } from '@/standardsCheck/common/utils/readCallBlocks';

/** A `let` declaration, however it is indented — the enclosing blocks decide whether it is shared state. */
const letDeclaration = /^\s*let\s+([A-Za-z0-9_$]+)/;

/** An assertion. */
const assertion = /\bexpect\s*\(/;

/** The closed nesting exception at unit-testing.md line 62: a nested describe naming a condition or a variant. */
const nestingException = /^(when|for)\s/;

/** An asymmetric matcher: with one of these as its argument, `toStrictEqual` runs the matcher and nothing else. */
const asymmetricMatcher = /expect\.(?:objectContaining|arrayContaining|any|stringContaining|stringMatching)\s*\(/;

/** A call to a `setup`-prefixed factory. */
const setupCall = /\bsetup[A-Za-z0-9_$]*\s*\(/g;

// Only a FLAT destructured parameter list is measured: a nested object in a
// default value takes the pattern past `[^{}]*` and the factory goes unjudged.
// Failing closed is right for an advisory cap — a miscounted number would read
// as a measurement while being a guess.
const setupFactory = /\bconst\s+(setup[A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?\(\s*\{([^{}]*)\}/g;

/** Properties a destructured parameter list declares — split on the commas sitting outside every bracket. */
const declaredProperties = ({ inner }: { inner: string }) => {
	const parts: string[] = [];
	let depth = 0;
	let current = '';

	for (const char of inner) {
		depth += '(['.includes(char) ? 1 : ')]'.includes(char) ? -1 : 0;

		if (char === ',' && depth === 0) {
			parts.push(current);
			current = '';
			continue;
		}

		current += char;
	}

	return [...parts, current].filter((part) => part.trim() !== '');
};

// `test-shared-let`. A `let` inside a hook or a test body is that block's own
// local; only one declared at module or describe scope can be the mutable
// subject line 93 bans, and only when a `beforeEach` reassigns it.
const sharedLetFinding = ({ file, text, blocks, beforeEachBlocks }: { file: string; text: string; blocks: CallBlock[]; beforeEachBlocks: CallBlock[] }) => {
	const shared: Array<{ name: string; line: number }> = [];

	text.split('\n').forEach((line, index) => {
		const name = line.match(letDeclaration)?.[1] ?? '';
		const number = index + 1;
		const local = blocks.some((block) => block.startLine <= number && number <= block.endLine);

		if (name !== '' && !local && beforeEachBlocks.some((block) => new RegExp(`\\b${name}\\s*=(?![=>])`).test(block.body))) {
			shared.push({ name, line: number });
		}
	});

	return shared.length === 0
		? undefined
		: buildFinding({
				rule: StandardsRule.TestSharedLet,
				files: buildLineSites({ file, spans: shared.map(({ line }) => ({ startLine: line, endLine: line })) }),
				detail: `${shared.map(({ name, line }) => `'${name}' (line ${line})`).join(', ')} reassigned in a beforeEach`,
				guidance: 'Arrange in a `setup()` factory that returns its locals as consts, so no test depends on what another left behind.',
			});
};

// `test-nested-describe`.
const nestedDescribeFinding = ({ file, text }: { file: string; text: string }) => {
	const nested = readCallBlocks({ text, callees: ['describe'] }).filter((block) => block.depth > 0 && !nestingException.test(block.title));

	return nested.length === 0
		? undefined
		: buildFinding({
				rule: StandardsRule.TestNestedDescribe,
				files: buildLineSites({ file, spans: nested }),
				detail: `${nested.map((block) => `'${block.title}' (line ${block.startLine})`).join(', ')} nested inside another describe`,
				guidance: 'Keep describe blocks flat — scenario variants come from `setup()` parameters, or from a `when …` / `for …` title.',
			});
};

// `test-strict-equal-matcher`.
const strictEqualFinding = ({ file, text }: { file: string; text: string }) => {
	const misleading = readCallBlocks({ text, callees: ['toStrictEqual'] }).filter((block) => asymmetricMatcher.test(block.body));

	return misleading.length === 0
		? undefined
		: buildFinding({
				rule: StandardsRule.TestStrictEqualMatcher,
				files: buildLineSites({ file, spans: misleading }),
				detail: `toStrictEqual with an asymmetric matcher at line(s) ${misleading.map((block) => block.startLine).join(', ')}`,
				guidance: 'Jest runs only the matcher, so the strict extra-property checks never fire — write `toEqual`, or assert a concrete object.',
			});
};

// `test-multiple-setups` (advisory). A helper legitimately named
// `setupSomething` may be called by another factory, so this is a prompt to look
// rather than a violation.
const multipleSetupsFinding = ({ file, blocks }: { file: string; blocks: CallBlock[] }) => {
	const overArranged = blocks.filter((block) => (block.callee === 'test' || block.callee === 'it') && [...block.body.matchAll(setupCall)].length > 1);

	return overArranged.length === 0
		? undefined
		: buildFinding({
				rule: StandardsRule.TestMultipleSetups,
				files: buildLineSites({ file, spans: overArranged }),
				detail: `${overArranged.map((block) => `'${block.title}' (line ${block.startLine})`).join(', ')} calls more than one setup factory`,
				guidance: 'Two setups means two tests. Heuristic — judge before acting.',
			});
};

// `test-mega-factory` (advisory). The cap is the doc's judgment made countable,
// and a repo may retune it through the rule's settings.
const megaFactoryFinding = ({ file, text, maxParams }: { file: string; text: string; maxParams: number }) => {
	const sprawling: Array<{ name: string; count: number; startLine: number; endLine: number }> = [];

	for (const match of text.matchAll(setupFactory)) {
		const properties = declaredProperties({ inner: match[2] });

		if (properties.length > maxParams) {
			sprawling.push({
				name: match[1],
				count: properties.length,
				startLine: getLineNumber({ text, index: match.index }),
				endLine: getLineNumber({ text, index: match.index + match[0].length }),
			});
		}
	}

	return sprawling.length === 0
		? undefined
		: buildFinding({
				rule: StandardsRule.TestMegaFactory,
				files: buildLineSites({ file, spans: sprawling }),
				detail: `${sprawling.map((factory) => `'${factory.name}' takes ${factory.count} parameters (line ${factory.startLine})`).join(', ')}, over the cap of ${maxParams}`,
				guidance: 'A substantially different arrangement gets a second named factory. Heuristic — judge before acting.',
			});
};

interface Params {
	file: string;
	text: string;
	/** This file's rule settings — `test-mega-factory`'s `maxParams`. */
	settings: Record<string, number>;
}

/**
 * The six structure rules of standards/tests/unit/jest/unit-testing.md for one
 * test file: mutable state shared through a hook, assertions that never reach
 * the test body, describe pyramids, a strict matcher that is not strict, and
 * the two judgment calls the doc caps rather than forbids.
 *
 * Text-level like its mock counterpart, and with the same bounded blind spot: a
 * hook reached through a helper, or a describe title built at runtime, produces
 * no block and therefore no finding.
 *
 * A module internal — its behaviour is pinned through `checkTestShape`.
 */
export const checkTestStructureRules = ({ file, text, settings }: Params): StandardsFinding[] => {
	const blocks = readCallBlocks({ text, callees: ['beforeEach', 'beforeAll', 'afterEach', 'afterAll', 'test', 'it'] });
	const beforeEachBlocks = blocks.filter((block) => block.callee === 'beforeEach');

	return [
		sharedLetFinding({ file, text, blocks, beforeEachBlocks }),
		// `test-assert-in-hook`. `beforeEach` only, the single hook line 94 names —
		// an `expect` in an `afterEach` is an ordinary leak check the doc never
		// bans.
		buildHookFinding({
			file,
			blocks: beforeEachBlocks,
			rule: StandardsRule.TestAssertInHook,
			pattern: assertion,
			detailSuffix: 'asserts',
			guidance: 'Act and assert live in the `test`; a hook only arranges.',
		}),
		nestedDescribeFinding({ file, text }),
		strictEqualFinding({ file, text }),
		multipleSetupsFinding({ file, blocks }),
		megaFactoryFinding({ file, text, maxParams: settings.maxParams }),
	].filter((finding): finding is StandardsFinding => finding !== undefined);
};
