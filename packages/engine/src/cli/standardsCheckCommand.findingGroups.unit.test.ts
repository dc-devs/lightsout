import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { standardsCheckCommand } from '#src/cli/standardsCheckCommand.ts';
import { type LightsoutConfig, type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import type { StandardsRuleListing } from '#src/standardsCheck/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

// Mocked Imports
// -------------------------
// Both halves of the check are other modules' entry points with their own
// tests. What this file pins is the shape the command prints whatever they
// found in: one heading per rule, the rows beneath it, and the guidance beside
// the rows it covers.

interface RunStandardsCheckParams {
	cwd: string;
	path?: string;
	all?: boolean;
	writeBaseline?: boolean;
	persist?: boolean;
	onProgress?: (message: string) => void;
}

const mockRunStandardsCheck = jest.fn<(params: RunStandardsCheckParams) => Promise<{ findings: StandardsFinding[]; notes: string[] }>>();

interface ListStandardsRulesParams {
	cwd: string;
	config?: LightsoutConfig;
}

const mockListStandardsRules = jest.fn<(params: ListStandardsRulesParams) => Promise<StandardsRuleListing[]>>();

jest.mock('#src/standardsCheck/index.ts', () => ({
	runStandardsCheck: (params: RunStandardsCheckParams) => mockRunStandardsCheck(params),
	listStandardsRules: (params: ListStandardsRulesParams) => mockListStandardsRules(params),
	// This file reads what the command printed, never the evidence file it wrote.
	writeStandardsSnapshot: () => Promise.resolve(),
}));
// -------------------------

const finding = (overrides: Partial<StandardsFinding> = {}): StandardsFinding => ({
	rule: 'size-function',
	severity: StandardsSeverity.Advisory,
	siteKey: 'size:one',
	files: [{ path: 'src/a.ts' }],
	detail: '81 lines',
	...overrides,
});

const listing = (overrides: Partial<StandardsRuleListing> = {}): StandardsRuleListing => ({
	rule: 'size-function',
	doc: 'lightsout-defaults: code/style-guide/structure/size',
	summary: 'a function longer than the size cap',
	checked: true,
	severity: StandardsSeverity.Advisory,
	fromConfig: false,
	settings: {},
	...overrides,
});

/**
 * The machine half alone, over a bare directory holding no config, reporting
 * exactly the given findings — so the rendered groups are the only thing the
 * assertions have to read past.
 */
const setupFindings = ({ findings }: { findings: StandardsFinding[] }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-test-'));

	mockListStandardsRules.mockResolvedValue([listing()]);
	mockRunStandardsCheck.mockResolvedValue({ findings, notes: [] });

	return { context: { flags: parseFlags({ args: ['--code-checks'] }), rest: [], cwd }, ...captured };
};

/** The group headings the renderer printed, in the order they were printed. */
const headingsOf = ({ logged }: { logged: string[] }) => logged.filter((line) => /^[⚠ℹ] /.test(line));

/** The rows and guidance lines, which share the four-space row indent — detail lines take six. */
const rowLinesOf = ({ logged }: { logged: string[] }) => logged.filter((line) => line.startsWith('    ') && !line.startsWith('     '));

describe('standardsCheckCommand finding groups', () => {
	test('a rule reporting several advisories pluralizes its heading, while blocking reads the same at any count', async () => {
		const { context, logged } = setupFindings({
			findings: [
				finding({
					rule: 'duplicate-code-block',
					severity: StandardsSeverity.Blocking,
					siteKey: 'duplicate-code-block:a',
					detail: 'the same 12 lines in 2 files',
				}),
				finding({
					rule: 'duplicate-code-block',
					severity: StandardsSeverity.Blocking,
					siteKey: 'duplicate-code-block:c',
					files: [{ path: 'src/c.ts' }],
					detail: 'the same 9 lines in 2 files',
				}),
				finding({ siteKey: 'size:one' }),
				finding({ siteKey: 'size:two', files: [{ path: 'src/b.ts' }], detail: '92 lines' }),
			],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(headingsOf({ logged })).toStrictEqual(['⚠ duplicate-code-block · 2 blocking', 'ℹ size-function · 2 advisories']);
	});

	test('a finding that starts and ends on one line names that line once, never as a range onto itself', async () => {
		const { context, logged } = setupFindings({ findings: [finding({ files: [{ path: 'src/a.ts', startLine: 42, endLine: 42 }] })] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('    src/a.ts:42  81 lines');
	});

	test('a location too long for the aligned column takes a line of its own, with the detail beneath it', async () => {
		// 57 characters — past the point where an aligned row would push every
		// detail in the group off the right edge
		const longPath = 'src/features/reporting/common/utils/buildReportSummary.ts';
		const { context, logged } = setupFindings({ findings: [finding({ files: [{ path: longPath }] })] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain(`    ${longPath}`);
		expect(logged).toContain('      81 lines');
	});

	test('a rule reporting two different problems states each fix beside its own rows, rather than once for the whole group', async () => {
		const { context, logged } = setupFindings({
			findings: [
				finding({ siteKey: 'size:a', guidance: 'split the function into named steps' }),
				finding({ siteKey: 'size:b', files: [{ path: 'src/b.ts' }], detail: '92 lines', guidance: 'move the loop body into its own function' }),
			],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(rowLinesOf({ logged })).toStrictEqual([
			'    src/a.ts  81 lines',
			'    split the function into named steps',
			'    src/b.ts  92 lines',
			'    move the loop body into its own function',
		]);
	});
});
