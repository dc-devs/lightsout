import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTestFileInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/** A module-scope `let` on line 1 that a `beforeEach` reassigns — the shape the rule bans. */
const sharedLetSource = ['let subject: string;', '', "describe('subject', () => {", '\tbeforeEach(() => {', "\t\tsubject = 'ready';", '\t});', '});'].join(
	'\n',
);

/** Two module-scope `let`s, on lines 1 and 2, both reassigned by the same hook. */
const twoSharedLetsSource = [
	'let subject: string;',
	'let helper: string;',
	'',
	"describe('subject', () => {",
	'\tbeforeEach(() => {',
	"\t\tsubject = 'ready';",
	"\t\thelper = 'ready';",
	'\t});',
	'});',
].join('\n');

/** A `let` declared inside the hook itself — that block's own local, not state shared between tests. */
const hookLocalLetSource = ["describe('subject', () => {", '\tbeforeEach(() => {', "\t\tlet subject = 'ready';", "\t\tsubject = 'set';", '\t});', '});'].join(
	'\n',
);

/** A module-scope `let` that only a test writes to — no hook leaves anything behind for the next test. */
const testAssignedLetSource = [
	"let subject = 'ready';",
	'',
	"describe('subject', () => {",
	"\ttest('sets the subject', () => {",
	"\t\tsubject = 'set';",
	'\t});',
	'});',
].join('\n');

/** A module-scope `let` a hook only compares against — reading is not reassigning. */
const comparedLetSource = [
	"let subject = 'ready';",
	'',
	"describe('subject', () => {",
	'\tbeforeEach(() => {',
	"\t\texpect(subject === 'ready').toBe(true);",
	'\t});',
	'});',
].join('\n');

describe('test-shared-let check', () => {
	test('asks for test files, the one input kind that carries test text alone', () => {
		expect(check.inputKind).toBe('test-file');
	});

	test('reports a module-scope let that a beforeEach reassigns', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', sharedLetSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-shared-let:src/feature/getLabel.unit.test.ts',
				files: [{ path: 'src/feature/getLabel.unit.test.ts', startLine: 1, endLine: 1 }],
				detail: "'subject' (line 1) reassigned in a beforeEach",
				guidance: 'Arrange in a `setup()` factory that returns its locals as consts, so no test depends on what another left behind.',
			},
		]);
	});

	test('names every shared let of one file in a single finding, each with its own line', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', twoSharedLetsSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-shared-let:src/feature/getLabel.unit.test.ts',
				files: [
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 1, endLine: 1 },
					{ path: 'src/feature/getLabel.unit.test.ts', startLine: 2, endLine: 2 },
				],
				detail: "'subject' (line 1), 'helper' (line 2) reassigned in a beforeEach",
				guidance: 'Arrange in a `setup()` factory that returns its locals as consts, so no test depends on what another left behind.',
			},
		]);
	});

	test('leaves a let declared inside the hook alone — a block local outlives nothing', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', hookLocalLetSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a module-scope let alone when only a test writes to it', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', testAssignedLetSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a module-scope let alone when the hook only compares it', async () => {
		const input = setupTestFileInput({ contents: [['src/feature/getLabel.unit.test.ts', comparedLetSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
