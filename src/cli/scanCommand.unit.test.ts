import { expect, describe, test, jest } from '@jest/globals';
import { StandardsRule, StandardsSeverity, type StandardsFinding } from '@/contracts';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { scanCommand } from '@/cli/scanCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';

// Mocked Imports
// -------------------------
// The scan itself is another module's entry point: it reads the whole repo from
// disk and is covered by its own tests. What this command owns is the flags it
// hands over, the order it prints the result in, and how it ends — all of which
// are observable with the scan stubbed.

interface RunScanParams {
	cwd: string;
	path?: string;
	all?: boolean;
	writeBaseline?: boolean;
	persist?: boolean;
	onProgress?: (message: string) => void;
}

const mockRunScan = jest.fn<(params: RunScanParams) => Promise<{ findings: StandardsFinding[]; notes: string[] }>>();

jest.mock('@/scan', () => ({ runScan: (params: RunScanParams) => mockRunScan(params) }));
// -------------------------

const finding = (overrides: Partial<StandardsFinding> = {}): StandardsFinding => ({
	rule: StandardsRule.Size,
	severity: StandardsSeverity.Advisory,
	siteKey: 'size:one',
	files: [{ path: 'src/a.ts' }],
	detail: '81 lines',
	...overrides,
});

const setupScan = ({
	args = [],
	findings = [],
	notes = [],
	progress = [],
}: { args?: string[]; findings?: StandardsFinding[]; notes?: string[]; progress?: string[] } = {}) => {
	const captured = captureCommandOutput();

	mockRunScan.mockImplementation(async ({ onProgress }) => {
		for (const message of progress) {
			onProgress?.(message);
		}

		return { findings, notes };
	});

	return { context: { flags: parseFlags({ args }), rest: [], cwd: '/repo' }, ...captured };
};

/** The group headings the renderer printed, in the order they were printed. */
const headingsOf = ({ logged }: { logged: string[] }) => logged.filter((line) => line.includes(' · '));

/** What the command handed the scan. */
const scanParams = () => mockRunScan.mock.calls[0]?.[0];

describe('scanCommand', () => {
	test('findings are printed before advisories, whatever order the scan returned them in', async () => {
		const { context, logged } = setupScan({
			findings: [finding(), finding({ rule: StandardsRule.Clone, severity: StandardsSeverity.Finding, siteKey: 'clone:src/a.ts:1' })],
		});

		await expect(scanCommand(context)).rejects.toThrow(/process\.exit/);

		// an advisory read first would set the wrong expectation about the work
		expect(headingsOf({ logged })).toStrictEqual(['⚠ clone · 1 finding', 'ℹ size · 1 advisory']);
	});

	test('the same findings-first order carries into the summary table', async () => {
		const { context, logged } = setupScan({
			findings: [finding(), finding({ rule: StandardsRule.ModuleBoundary, severity: StandardsSeverity.Finding, siteKey: 'boundary:src/a.ts' })],
		});

		await expect(scanCommand(context)).rejects.toThrow(/process\.exit/);

		const ruleColumn = logged.filter((line) => line.startsWith('│')).map((line) => line.split('│')[1]?.trim());

		expect(ruleColumn).toStrictEqual(['rule', 'module-boundary', 'size', 'total']);
	});

	test('names the report file and exits 0, so a caller reads success from the exit code', async () => {
		const { context, logged, errors, exitCodes } = setupScan({ findings: [finding()] });

		await expect(scanCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('report: .lightsout/scan.json');
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('hands the scan the repo, the subpath, and both switches when the flags ask for them', async () => {
		const { context } = setupScan({ args: ['--path', 'src/cli', '--all', '--baseline'] });

		await expect(scanCommand(context)).rejects.toThrow(/process\.exit/);

		expect(scanParams()).toEqual(expect.objectContaining({ cwd: '/repo', path: 'src/cli', all: true, writeBaseline: true }));
	});

	test('with no flags it scans the whole repo, reports only what is new, and writes no baseline', async () => {
		const { context } = setupScan();

		await expect(scanCommand(context)).rejects.toThrow(/process\.exit/);

		// baselining is an explicit act, never a side effect of a plain scan
		expect(scanParams()).toEqual(expect.objectContaining({ path: undefined, all: false, writeBaseline: false }));
	});

	test('a --path flag given without a value is no subpath at all', async () => {
		const { context } = setupScan({ args: ['--path'] });

		await expect(scanCommand(context)).rejects.toThrow(/process\.exit/);

		expect(scanParams()).toEqual(expect.objectContaining({ path: undefined }));
	});

	test('progress reaches the terminal as the scan reports it, ahead of any result', async () => {
		const { context, logged } = setupScan({ progress: ['scanning 12 source file(s)', 'tier 0 (names): done'], findings: [finding()] });

		await expect(scanCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged.slice(0, 2)).toStrictEqual(['scanning 12 source file(s)', 'tier 0 (names): done']);
	});

	test("the scan's notes are printed under their own marker", async () => {
		const { context, logged } = setupScan({ findings: [finding()], notes: ['3 site(s) held back by the baseline'] });

		await expect(scanCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('ℹ 3 site(s) held back by the baseline');
	});

	test('a clean repo with nothing to note prints the clean line and no note block', async () => {
		const { context, logged, exitCodes } = setupScan();

		await expect(scanCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('clean — no findings, no advisories');
		expect(logged.some((line) => line.startsWith('ℹ'))).toBe(false);
		expect(exitCodes).toStrictEqual([0]);
	});
});
