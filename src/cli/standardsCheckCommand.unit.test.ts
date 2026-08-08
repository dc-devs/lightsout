import { expect, describe, test, jest } from '@jest/globals';
import { StandardsRule, StandardsSeverity, type StandardsFinding } from '@/contracts';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { standardsCheckCommand } from '@/cli/standardsCheckCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';

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

jest.mock('@/standardsCheck', () => ({ runStandardsCheck: (params: RunStandardsCheckParams) => mockRunStandardsCheck(params) }));
// -------------------------

const finding = (overrides: Partial<StandardsFinding> = {}): StandardsFinding => ({
	rule: StandardsRule.Size,
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

/** The group headings the renderer printed, in the order they were printed. */
const headingsOf = ({ logged }: { logged: string[] }) => logged.filter((line) => line.includes(' · '));

/** What the command handed the standards check. */
const checkParams = () => mockRunStandardsCheck.mock.calls[0]?.[0];

describe('standardsCheckCommand', () => {
	test('findings are printed before advisories, whatever order the check returned them in', async () => {
		const { context, logged } = setupCheck({
			findings: [finding(), finding({ rule: StandardsRule.Clone, severity: StandardsSeverity.Finding, siteKey: 'clone:src/a.ts:1' })],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// an advisory read first would set the wrong expectation about the work
		expect(headingsOf({ logged })).toStrictEqual(['⚠ clone · 1 finding', 'ℹ size · 1 advisory']);
	});

	test('the same findings-first order carries into the summary table', async () => {
		const { context, logged } = setupCheck({
			findings: [finding(), finding({ rule: StandardsRule.ModuleBoundary, severity: StandardsSeverity.Finding, siteKey: 'boundary:src/a.ts' })],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		const ruleColumn = logged.filter((line) => line.startsWith('│')).map((line) => line.split('│')[1]?.trim());

		expect(ruleColumn).toStrictEqual(['rule', 'module-boundary', 'size', 'total']);
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

		expect(logged).toContain('clean — no findings, no advisories');
		expect(logged.some((line) => line.startsWith('ℹ'))).toBe(false);
		expect(exitCodes).toStrictEqual([0]);
	});
});
