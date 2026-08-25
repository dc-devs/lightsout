import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { standardsCheckCommand } from '#src/cli/standardsCheckCommand.ts';
import { type LightsoutConfig, type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import type { StandardsRuleListing } from '#src/standardsCheck/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Mocked Imports
// -------------------------
// Both halves of the check are other modules' entry points, and each has its own tests — the review's
// resolution beside reviewStandards.ts, the table shapes beside their renderers. What this command owns
// is the flags it hands over, which halves it runs, the order it prints the result in, what it writes,
// and how it ends — all of which are observable with both halves stubbed.

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

interface ReviewStandardsParams {
	cwd: string;
	config?: LightsoutConfig;
	path?: string;
	onProgress?: (message: string) => void;
}

const mockReviewStandards = jest.fn<(params: ReviewStandardsParams) => Promise<{ findings: StandardsFinding[]; notes: string[] }>>();

jest.mock('#src/standardsCheck/index.ts', () => ({
	runStandardsCheck: (params: RunStandardsCheckParams) => mockRunStandardsCheck(params),
	listStandardsRules: (params: ListStandardsRulesParams) => mockListStandardsRules(params),
	// The writer stays real — what the command leaves on disk is one of the things asserted below.
	writeStandardsSnapshot: jest.requireActual<typeof import('#src/standardsCheck/index.ts')>('#src/standardsCheck/index.ts').writeStandardsSnapshot,
}));
jest.mock('#src/cli/reviewStandards.ts', () => ({ reviewStandards: (params: ReviewStandardsParams) => mockReviewStandards(params) }));
// -------------------------

const finding = (overrides: Partial<StandardsFinding> = {}): StandardsFinding => ({
	rule: 'size-function',
	severity: StandardsSeverity.Advisory,
	siteKey: 'size:one',
	files: [{ path: 'src/a.ts' }],
	detail: '81 lines',
	...overrides,
});

const setupCheck = ({
	args = ['--code-checks'],
	check = {},
	review = {},
	rules,
	config,
}: {
	args?: string[];
	/** What the machine half returns, and the progress it reports on the way. */
	check?: { findings?: StandardsFinding[]; notes?: string[]; progress?: string[] };
	/** What the agent half returns. */
	review?: { findings?: StandardsFinding[]; notes?: string[] };
	rules?: StandardsRuleListing[];
	/** The config the repo carries on disk — given one, the cwd is a repo holding it. */
	config?: Record<string, unknown>;
} = {}) => {
	const captured = captureCommandOutput();
	const cwd = config === undefined ? mkdtempSync(join(tmpdir(), 'lightsout-test-')) : setupConsumerRepo({ git: false, config });

	// The run path reads the listing too — it is where each reported rule's
	// one-line summary comes from — so the stub answers on both paths.
	mockListStandardsRules.mockResolvedValue(rules ?? [listing({ rule: 'size-function', summary: 'a function longer than the size cap' })]);

	mockRunStandardsCheck.mockImplementation(async ({ onProgress }) => {
		for (const message of check.progress ?? []) {
			onProgress?.(message);
		}

		return { findings: check.findings ?? [], notes: check.notes ?? [] };
	});

	mockReviewStandards.mockResolvedValue({ findings: review.findings ?? [], notes: review.notes ?? [] });

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

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
 * The --list path is its own arrangement: it runs no check, and it reads the
 * repo's config off disk, so the cwd has to be a real directory — one holding a
 * config, or one holding none.
 */
const setupRuleList = ({ cwd, rules = [listing()] }: { cwd: string; rules?: StandardsRuleListing[] }) => {
	const captured = captureCommandOutput();

	mockListStandardsRules.mockResolvedValue(rules);

	return { context: { flags: parseFlags({ args: ['--list'] }), rest: [], cwd }, ...captured };
};

/** The finding-group headings the renderer printed, in the order they were printed — the section headings carry no icon. */
const headingsOf = ({ logged }: { logged: string[] }) => logged.filter((line) => /^[⚠ℹ] /.test(line));

/** The printed table's rows, cell by cell. */
const cellsOf = ({ logged }: { logged: string[] }) =>
	logged
		.filter((line) => line.startsWith('│'))
		.map((line) =>
			line
				.split('│')
				.slice(1, -1)
				.map((cell) => cell.trim()),
		);

/** What the command handed the standards check. */
const checkParams = () => mockRunStandardsCheck.mock.calls[0]?.[0];

/** What the command handed the rule ledger. */
const listParams = () => mockListStandardsRules.mock.calls[0]?.[0];

describe('standardsCheckCommand', () => {
	test('blocking is printed before advisories — in the finding groups and again in the summary table', async () => {
		const { context, logged } = setupCheck({
			check: { findings: [finding(), finding({ rule: 'module-boundary', severity: StandardsSeverity.Blocking, siteKey: 'boundary:src/a.ts' })] },
			rules: [
				listing({ rule: 'size-function', summary: 'a function longer than the size cap' }),
				listing({ rule: 'module-boundary', summary: 'a file deep-imported across a module boundary' }),
			],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// an advisory read first would set the wrong expectation about the work
		expect(headingsOf({ logged })).toStrictEqual(['⚠ module-boundary · 1 blocking', 'ℹ size-function · 1 advisory']);

		const ruleColumn = logged.filter((line) => line.startsWith('│')).map((line) => line.split('│')[1]?.trim());

		// the same order carries into the table, each rule's summary under its own
		// row rather than under whichever row the check happened to report first
		expect(ruleColumn).toStrictEqual([
			'rule',
			'module-boundary',
			'a file deep-imported across a module boundary',
			'size-function',
			'a function longer than the size cap',
			'total',
		]);
	});

	test('names the report file and exits 0, so a caller reads success from the exit code', async () => {
		const { context, logged, errors, exitCodes } = setupCheck({ check: { findings: [finding()] } });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('report: .lightsout/standards-check.json');
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('hands the check the repo, the subpath, and both switches when the flags ask for them', async () => {
		const { context, cwd } = setupCheck({ args: ['--code-checks', '--path', 'src/cli', '--all', '--baseline'] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(checkParams()).toEqual(expect.objectContaining({ cwd, path: 'src/cli', all: true, writeBaseline: true }));
	});

	test('with no flags it checks the whole repo, reports only what is new, and writes no baseline', async () => {
		const { context } = setupCheck();

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// baselining is an explicit act, never a side effect of a plain run
		expect(checkParams()).toEqual(expect.objectContaining({ path: undefined, all: false, writeBaseline: false }));
	});

	test('a --path flag given without a value is no subpath at all', async () => {
		const { context } = setupCheck({ args: ['--code-checks', '--path'] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(checkParams()).toEqual(expect.objectContaining({ path: undefined }));
	});

	test('a clean repo with nothing to note prints the clean line and no note block', async () => {
		const { context, logged, exitCodes } = setupCheck();

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('clean — nothing blocking, no advisories');
		expect(logged.some((line) => line.startsWith('ℹ'))).toBe(false);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('--list prints the resolved ledger and answers without running a single check', async () => {
		// the table's full shape is printStandardsRuleList's own test's to pin —
		// what the command owns is that the resolved rules reach it, and that
		// listing is a read, never a run. The bare directory is also the no-config
		// case: every rule still answers, at its default.
		const { context, logged, exitCodes } = setupRuleList({ cwd: mkdtempSync(join(tmpdir(), 'lightsout-test-')) });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(listParams()?.config).toBeUndefined();
		expect(cellsOf({ logged })).toContainEqual(['multi-export', 'blocking', 'code', 'lightsout-defaults: code/style-guide/structure/one-export-per-file']);
		expect(mockRunStandardsCheck).not.toHaveBeenCalled();
		expect(mockReviewStandards).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a ledger that cannot be built stops the command before any check runs', async () => {
		const { context, exitCodes } = setupCheck();
		mockListStandardsRules.mockRejectedValue(new Error('standards pack "acme" could not be loaded'));

		await expect(standardsCheckCommand(context)).rejects.toThrow('standards pack "acme" could not be loaded');

		// a repo whose configured packages cannot load must not half-run: no check,
		// and no exit code claiming the repo came back clean
		expect(mockRunStandardsCheck).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([]);
	});

	test('with no selector both halves run — this is a standards check, and both halves are the check', async () => {
		const { context } = setupCheck({ args: [] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRunStandardsCheck).toHaveBeenCalled();
		expect(mockReviewStandards).toHaveBeenCalled();
	});

	test('--code-checks runs only the half code does', async () => {
		const { context } = setupCheck({ args: ['--code-checks'] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRunStandardsCheck).toHaveBeenCalled();
		expect(mockReviewStandards).not.toHaveBeenCalled();
	});

	test('--agent-review runs only the half an agent does', async () => {
		const { context } = setupCheck({ args: ['--agent-review'] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRunStandardsCheck).not.toHaveBeenCalled();
		expect(mockReviewStandards).toHaveBeenCalled();
	});

	test('naming both halves runs both, exactly as naming neither does', async () => {
		const { context } = setupCheck({ args: ['--code-checks', '--agent-review'] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// each flag names an actor to keep, so keeping both is not a contradiction
		expect(mockRunStandardsCheck).toHaveBeenCalled();
		expect(mockReviewStandards).toHaveBeenCalled();
	});

	test('the review gets the repo, its config, and the subpath the flag named', async () => {
		const { context, cwd } = setupCheck({ args: ['--agent-review', '--path', 'src'], config: { harness: 'codex' } });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// resolution is reviewStandards' own concern, tested beside it — what the
		// command owes it is the repo, the loaded config, and the scope
		const params = mockReviewStandards.mock.calls[0]?.[0];

		expect(params?.cwd).toBe(cwd);
		expect(params?.config).toEqual(expect.objectContaining({ harness: 'codex' }));
		expect(params?.path).toBe('src');
	});

	test('review findings join the same stream, printed under their own section after the code checks have already reported', async () => {
		const { context, logged } = setupCheck({
			args: [],
			check: { findings: [finding({ rule: 'duplicate-code-block', severity: StandardsSeverity.Blocking, siteKey: 'duplicate-code-block:src/a.ts:1' })] },
			review: { findings: [finding({ rule: 'path-aliases', siteKey: 'path-aliases:src/a.ts', detail: 'a relative import in an aliased package' })] },
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(headingsOf({ logged })).toStrictEqual(['⚠ duplicate-code-block · 1 blocking', 'ℹ path-aliases · 1 advisory']);
		// the fast half's answer is on screen before the slow half starts — a
		// reader waiting on the agent already has the deterministic result
		expect(logged.indexOf('⚠ duplicate-code-block · 1 blocking')).toBeLessThan(logged.indexOf('Agent review'));
	});

	test('a finding spanning several files lists every site, then wraps its detail and its guidance underneath', async () => {
		const spanning = finding({
			rule: 'duplicate-code-block',
			siteKey: 'duplicate-code-block:src/a.ts:3',
			files: [
				{ path: 'src/a.ts', startLine: 3 },
				{ path: 'src/b.ts', startLine: 9, endLine: 20 },
			],
			detail: 'the same 12 lines in 2 files',
			guidance: 'extract the shared block into one module',
		});
		const { context, logged } = setupCheck({
			check: { findings: [spanning] },
			rules: [listing({ rule: 'duplicate-code-block', summary: 'the same code in more than one place' })],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// no single location to align a row on, so each site gets its own line
		expect(logged).toContain('    src/a.ts:3');
		expect(logged).toContain('    src/b.ts:9-20');
		expect(logged).toContain('      the same 12 lines in 2 files');
		// the guidance is stated once beneath the rows it covers
		expect(logged).toContain('    extract the shared block into one module');
	});
});
