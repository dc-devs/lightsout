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
// Resolving the ledger off disk is another module's entry point with its own
// tests. What `--list` owns is the table it renders from whatever that ledger
// answered — the state every rule runs at, who checks it, and the totals
// beneath.

interface ListStandardsRulesParams {
	cwd: string;
	config?: LightsoutConfig;
}

const mockListStandardsRules = jest.fn<(params: ListStandardsRulesParams) => Promise<StandardsRuleListing[]>>();

interface RunStandardsCheckParams {
	cwd: string;
	path?: string;
	all?: boolean;
	writeBaseline?: boolean;
	persist?: boolean;
	onProgress?: (message: string) => void;
}

const mockRunStandardsCheck = jest.fn<(params: RunStandardsCheckParams) => Promise<{ findings: StandardsFinding[]; notes: string[] }>>();

jest.mock('#src/standardsCheck/index.ts', () => ({
	listStandardsRules: (params: ListStandardsRulesParams) => mockListStandardsRules(params),
	runStandardsCheck: (params: RunStandardsCheckParams) => mockRunStandardsCheck(params),
}));
// -------------------------

const listing = (overrides: Partial<StandardsRuleListing> = {}): StandardsRuleListing => ({
	rule: 'multi-export',
	doc: 'lightsout-defaults: code/style-guide/structure/one-export-per-file',
	summary: 'more than one export in a file',
	checked: true,
	severity: StandardsSeverity.Blocking,
	fromConfig: false,
	settings: {},
	...overrides,
});

/**
 * The `--list` path over a bare directory holding no config, answering with the
 * given ledger. Listing runs no check, so nothing here needs a consumer repo.
 */
const setupRuleList = ({ rules }: { rules: StandardsRuleListing[] }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-test-'));

	mockListStandardsRules.mockResolvedValue(rules);

	return { context: { flags: parseFlags({ args: ['--list'] }), rest: [], cwd }, ...captured };
};

/** The printed table's rows, cell by cell — index 0 is the header row. */
const cellsOf = ({ logged }: { logged: string[] }) =>
	logged
		.filter((line) => line.startsWith('│'))
		.map((line) =>
			line
				.split('│')
				.slice(1, -1)
				.map((cell) => cell.trim()),
		);

describe('standardsCheckCommand --list', () => {
	test('a rule this repo’s config set is marked as such, so its own policy never reads as the shipped default', async () => {
		const { context, logged } = setupRuleList({
			rules: [listing({ rule: 'size', doc: 'lightsout-defaults: code/style-guide/structure/size', fromConfig: true })],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(cellsOf({ logged })[1]).toStrictEqual(['size', 'blocking (config)', 'code', 'lightsout-defaults: code/style-guide/structure/size']);
	});

	test('a rule no code run will ever catch is listed as judgment — a ledger hiding that would read as though every rule were enforced', async () => {
		const { context, logged } = setupRuleList({
			rules: [
				listing({
					rule: 'plan-shape',
					doc: 'lightsout-defaults: plans/plan-shape',
					summary: 'a plan that states no decision log',
					checked: false,
					severity: StandardsSeverity.Advisory,
				}),
			],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(cellsOf({ logged })[1]).toStrictEqual(['plan-shape', 'advisory', 'judgment', 'lightsout-defaults: plans/plan-shape']);
	});

	test('a rule’s live numbers ride its summary line, so a retuned knob is visible without opening the config', async () => {
		const { context, logged } = setupRuleList({
			rules: [listing({ rule: 'size', summary: 'a file longer than the size cap', settings: { file: 250, tsxFile: 300 } })],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(cellsOf({ logged })[2]).toStrictEqual(['a file longer than the size cap — file 250, tsxFile 300', '', '', '']);
	});

	test('a rule with nothing tunable states its summary alone, never a trailing dash with nothing after it', async () => {
		const { context, logged } = setupRuleList({ rules: [listing()] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(cellsOf({ logged })[2]).toStrictEqual(['more than one export in a file', '', '', '']);
	});

	test('the totals line counts every state a rule can be in, so the ledger’s coverage claim is readable at the bottom', async () => {
		const { context, logged } = setupRuleList({
			rules: [
				listing({ rule: 'size', severity: StandardsSeverity.Blocking }),
				listing({ rule: 'plan-shape', severity: StandardsSeverity.Advisory, checked: false }),
				listing({ rule: 'multi-export', severity: StandardsSeverity.Off, fromConfig: true }),
			],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		const rows = cellsOf({ logged });

		// the honest half of a coverage claim: 3 rules, but only 2 a code run catches
		expect(rows[rows.length - 1]).toStrictEqual(['3 rule(s)', '1 blocking', '1 advisory, 1 off', '2 by code, 1 by judgment']);
	});
});
