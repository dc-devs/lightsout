import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, describe, test, jest } from '@jest/globals';
import { StandardsRule, StandardsSeverity, type LightsoutConfig, type StandardsFinding } from '@/contracts';
import type { StandardsRuleListing } from '@/standardsCheck';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { standardsCheckCommand } from '@/cli/standardsCheckCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

// Mocked Imports
// -------------------------
// The standards check itself is another module's entry point: it reads the whole
// repo from disk and is covered by its own tests. What this command owns is the
// flags it hands over, the order it prints the result in, and how it ends — all of
// which are observable with the check stubbed.

interface RunStandardsCheckParams {
	cwd: string;
	path?: string;
	all?: boolean;
	writeBaseline?: boolean;
	persist?: boolean;
	onProgress?: (message: string) => void;
}

const mockRunStandardsCheck = jest.fn<(params: RunStandardsCheckParams) => Promise<{ findings: StandardsFinding[]; notes: string[] }>>();
const mockListStandardsRules = jest.fn<(params: { config?: LightsoutConfig }) => StandardsRuleListing[]>();

jest.mock('@/standardsCheck', () => ({
	runStandardsCheck: (params: RunStandardsCheckParams) => mockRunStandardsCheck(params),
	listStandardsRules: (params: { config?: LightsoutConfig }) => mockListStandardsRules(params),
}));
// -------------------------

const finding = (overrides: Partial<StandardsFinding> = {}): StandardsFinding => ({
	rule: StandardsRule.SizeFunction,
	severity: StandardsSeverity.Advisory,
	siteKey: 'size:one',
	files: [{ path: 'src/a.ts' }],
	detail: '81 lines',
	...overrides,
});

const setupCheck = ({
	args = [],
	findings = [],
	notes = [],
	progress = [],
}: { args?: string[]; findings?: StandardsFinding[]; notes?: string[]; progress?: string[] } = {}) => {
	const captured = captureCommandOutput();

	mockRunStandardsCheck.mockImplementation(async ({ onProgress }) => {
		for (const message of progress) {
			onProgress?.(message);
		}

		return { findings, notes };
	});

	return { context: { flags: parseFlags({ args }), rest: [], cwd: '/repo' }, ...captured };
};

const listing = (overrides: Partial<StandardsRuleListing> = {}): StandardsRuleListing => ({
	rule: StandardsRule.MultiExport,
	doc: 'standards/code/style-guide/structure/one-export-per-file.md',
	summary: 'more than one export in a file',
	severity: StandardsSeverity.Blocking,
	fromConfig: false,
	settings: {},
	...overrides,
});

/**
 * The --list path is its own arrangement: it runs no check, and it reads the
 * repo's config off disk, so the cwd has to be a real directory — one holding a
 * config, or one holding none.
 */
const setupRuleList = ({ cwd, rules = [listing()] }: { cwd: string; rules?: StandardsRuleListing[] }) => {
	const captured = captureCommandOutput();

	mockListStandardsRules.mockReturnValue(rules);

	return { context: { flags: parseFlags({ args: ['--list'] }), rest: [], cwd }, ...captured };
};

/** The group headings the renderer printed, in the order they were printed. */
const headingsOf = ({ logged }: { logged: string[] }) => logged.filter((line) => line.includes(' · '));

/** The printed table's rows, cell by cell. */
const cellsOf = ({ logged }: { logged: string[] }) =>
	logged.filter((line) => line.startsWith('│')).map((line) => line.split('│').slice(1, -1).map((cell) => cell.trim()));

/** What the command handed the standards check. */
const checkParams = () => mockRunStandardsCheck.mock.calls[0]?.[0];

/** What the command handed the rule ledger. */
const listParams = () => mockListStandardsRules.mock.calls[0]?.[0];

describe('standardsCheckCommand', () => {
	test('blocking is printed before advisories, whatever order the check returned them in', async () => {
		const { context, logged } = setupCheck({
			findings: [finding(), finding({ rule: StandardsRule.Clone, severity: StandardsSeverity.Blocking, siteKey: 'clone:src/a.ts:1' })],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// an advisory read first would set the wrong expectation about the work
		expect(headingsOf({ logged })).toStrictEqual(['⚠ clone · 1 blocking', 'ℹ size-function · 1 advisory']);
	});

	test('the same findings-first order carries into the summary table', async () => {
		const { context, logged } = setupCheck({
			findings: [finding(), finding({ rule: StandardsRule.ModuleBoundary, severity: StandardsSeverity.Blocking, siteKey: 'boundary:src/a.ts' })],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		const ruleColumn = logged.filter((line) => line.startsWith('│')).map((line) => line.split('│')[1]?.trim());

		expect(ruleColumn).toStrictEqual(['rule', 'module-boundary', 'size-function', 'total']);
	});

	test('names the report file and exits 0, so a caller reads success from the exit code', async () => {
		const { context, logged, errors, exitCodes } = setupCheck({ findings: [finding()] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('report: .lightsout/standards-check.json');
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('hands the check the repo, the subpath, and both switches when the flags ask for them', async () => {
		const { context } = setupCheck({ args: ['--path', 'src/cli', '--all', '--baseline'] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(checkParams()).toEqual(expect.objectContaining({ cwd: '/repo', path: 'src/cli', all: true, writeBaseline: true }));
	});

	test('with no flags it checks the whole repo, reports only what is new, and writes no baseline', async () => {
		const { context } = setupCheck();

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// baselining is an explicit act, never a side effect of a plain run
		expect(checkParams()).toEqual(expect.objectContaining({ path: undefined, all: false, writeBaseline: false }));
	});

	test('a --path flag given without a value is no subpath at all', async () => {
		const { context } = setupCheck({ args: ['--path'] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(checkParams()).toEqual(expect.objectContaining({ path: undefined }));
	});

	test('progress reaches the terminal as the check reports it, ahead of any result', async () => {
		const { context, logged } = setupCheck({ progress: ['checking 12 source file(s)', 'tier 0 (names): done'], findings: [finding()] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged.slice(0, 2)).toStrictEqual(['checking 12 source file(s)', 'tier 0 (names): done']);
	});

	test("the check's notes are printed under their own marker", async () => {
		const { context, logged } = setupCheck({ findings: [finding()], notes: ['3 site(s) held back by the baseline'] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('ℹ 3 site(s) held back by the baseline');
	});

	test('a clean repo with nothing to note prints the clean line and no note block', async () => {
		const { context, logged, exitCodes } = setupCheck();

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('clean — nothing blocking, no advisories');
		expect(logged.some((line) => line.startsWith('ℹ'))).toBe(false);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('--list prints every rule with the state it runs at and the doc it enforces', async () => {
		const { context, logged } = setupRuleList({
			cwd: mkdtempSync(join(tmpdir(), 'lightsout-test-')),
			rules: [
				listing(),
				listing({
					rule: StandardsRule.Clone,
					doc: 'standards/code/architecture/architecture-decisions.md',
					summary: 'copy-pasted spans',
					severity: StandardsSeverity.Advisory,
					settings: { minTokens: 50 },
				}),
			],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(cellsOf({ logged })).toStrictEqual([
			['rule', 'state', 'standards doc'],
			['multi-export', 'blocking', 'standards/code/style-guide/structure/one-export-per-file.md'],
			['more than one export in a file', '', ''],
			['clone', 'advisory', 'standards/code/architecture/architecture-decisions.md'],
			['copy-pasted spans — minTokens 50', '', ''],
			['2 rule(s)', '1 blocking', '1 advisory, 0 off'],
		]);
	});

	test('--list answers the question without running a single check, and exits 0', async () => {
		const { context, exitCodes } = setupRuleList({ cwd: mkdtempSync(join(tmpdir(), 'lightsout-test-')) });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRunStandardsCheck).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([0]);
	});

	test("the repo's own config reaches the ledger, so what prints is this repo's policy", async () => {
		const { context } = setupRuleList({ cwd: setupConsumerRepo({ git: false, config: { standardsChecks: { clone: 'off' } } }) });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(listParams()?.config).toEqual(expect.objectContaining({ standardsChecks: { clone: 'off' } }));
	});

	test('a repo with no config still gets an answer — every rule at its default', async () => {
		const { context, logged } = setupRuleList({ cwd: mkdtempSync(join(tmpdir(), 'lightsout-test-')) });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// a missing config is tolerated here exactly as the run path tolerates it
		expect(listParams()).toStrictEqual({ config: undefined });
		expect(cellsOf({ logged })).toContainEqual(['multi-export', 'blocking', 'standards/code/style-guide/structure/one-export-per-file.md']);
	});
});
