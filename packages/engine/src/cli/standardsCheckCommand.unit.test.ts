import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { standardsCheckCommand } from '@/cli/standardsCheckCommand';
import { type LightsoutConfig, type StandardsFinding, StandardsSeverity } from '@/contracts';
import type { Driver } from '@/drivers';
import type { StandardsRuleListing } from '@/standardsCheck';
import type { LoadedStandardsPackage } from '@/standardsPackages';

// Mocked Imports
// -------------------------
// Both halves of the check are other modules' entry points: one reads the whole
// repo from disk, the other spawns a harness, and each has its own tests. What
// this command owns is the flags it hands over, which halves it runs, the order
// it prints the result in, what it writes, and how it ends — all of which are
// observable with both halves stubbed.

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

interface RunStandardsReviewParams {
	cwd: string;
	driver: Driver;
	packages: LoadedStandardsPackage[];
	channels: string[];
	files: string[];
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

const mockRunStandardsReview = jest.fn<(params: RunStandardsReviewParams) => Promise<{ findings: StandardsFinding[]; notes: string[] }>>();

jest.mock('@/standardsCheck', () => ({
	runStandardsCheck: (params: RunStandardsCheckParams) => mockRunStandardsCheck(params),
	listStandardsRules: (params: ListStandardsRulesParams) => mockListStandardsRules(params),
	runStandardsReview: (params: RunStandardsReviewParams) => mockRunStandardsReview(params),
}));
jest.mock('@/standardsPackages', () => ({ resolveStandardsPackages: async () => [] }));
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
	findings = [],
	notes = [],
	progress = [],
	rules,
	reviewFindings = [],
	reviewNotes = [],
	cwd = mkdtempSync(join(tmpdir(), 'lightsout-test-')),
}: {
	args?: string[];
	findings?: StandardsFinding[];
	notes?: string[];
	progress?: string[];
	rules?: StandardsRuleListing[];
	reviewFindings?: StandardsFinding[];
	reviewNotes?: string[];
	cwd?: string;
} = {}) => {
	const captured = captureCommandOutput();

	// The run path reads the listing too — it is where each reported rule's
	// one-line summary comes from — so the stub answers on both paths.
	mockListStandardsRules.mockResolvedValue(rules ?? [listing({ rule: 'size-function', summary: 'a function longer than the size cap' })]);

	mockRunStandardsCheck.mockImplementation(async ({ onProgress }) => {
		for (const message of progress) {
			onProgress?.(message);
		}

		return { findings, notes };
	});

	mockRunStandardsReview.mockResolvedValue({ findings: reviewFindings, notes: reviewNotes });

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

/** The typed evidence file, as the command left it — or undefined when it wrote none. */
const writtenReport = ({ cwd }: { cwd: string }) => {
	try {
		return JSON.parse(readFileSync(join(cwd, '.lightsout', 'standards-check.json'), 'utf8')) as { path: string; findings: StandardsFinding[]; notes: string[] };
	} catch {
		return undefined;
	}
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

/**
 * A repo the review has to read its own defaults off: no lightsout config at
 * all, and a manifest whose dependencies are the only thing that can decide the
 * channels.
 */
const setupUnconfiguredRepo = ({ dependencies = {} }: { dependencies?: Record<string, string> } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-test-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/index.ts'), 'export const one = 1;\n');
	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', dependencies }));

	return cwd;
};

/** What the command handed the agent review. */
const reviewParams = () => mockRunStandardsReview.mock.calls[0]?.[0];

/** The group headings the renderer printed, in the order they were printed. */
const headingsOf = ({ logged }: { logged: string[] }) => logged.filter((line) => line.includes(' · '));

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
	test('blocking is printed before advisories, whatever order the check returned them in', async () => {
		const { context, logged } = setupCheck({
			findings: [finding(), finding({ rule: 'clone', severity: StandardsSeverity.Blocking, siteKey: 'clone:src/a.ts:1' })],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// an advisory read first would set the wrong expectation about the work
		expect(headingsOf({ logged })).toStrictEqual(['⚠ clone · 1 blocking', 'ℹ size-function · 1 advisory']);
	});

	test('the same findings-first order carries into the summary table', async () => {
		const { context, logged } = setupCheck({
			findings: [finding(), finding({ rule: 'module-boundary', severity: StandardsSeverity.Blocking, siteKey: 'boundary:src/a.ts' })],
			rules: [
				listing({ rule: 'size-function', summary: 'a function longer than the size cap' }),
				listing({ rule: 'module-boundary', summary: 'a file deep-imported across a module boundary' }),
			],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		const ruleColumn = logged.filter((line) => line.startsWith('│')).map((line) => line.split('│')[1]?.trim());

		// blocking leads, and each rule's summary sits under its own row rather
		// than under whichever row the check happened to report first
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
		const { context, logged, errors, exitCodes } = setupCheck({ findings: [finding()] });

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

	test('--list prints every rule with the state it runs at, its checker and the doc it enforces', async () => {
		const { context, logged } = setupRuleList({
			cwd: mkdtempSync(join(tmpdir(), 'lightsout-test-')),
			rules: [
				listing(),
				listing({
					rule: 'clone',
					doc: 'lightsout-defaults: code/architecture/architecture-decisions',
					summary: 'copy-pasted spans',
					severity: StandardsSeverity.Advisory,
					settings: { minTokens: 50 },
				}),
				listing({
					rule: 'premature-abstraction',
					doc: 'lightsout-defaults: code/architecture/architecture-decisions',
					summary: 'abstracting before the third use',
					checked: false,
					severity: StandardsSeverity.Advisory,
				}),
			],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(cellsOf({ logged })).toStrictEqual([
			['rule', 'state', 'checked by', 'standards doc'],
			['multi-export', 'blocking', 'code', 'lightsout-defaults: code/style-guide/structure/one-export-per-file'],
			['more than one export in a file', '', '', ''],
			['clone', 'advisory', 'code', 'lightsout-defaults: code/architecture/architecture-decisions'],
			['copy-pasted spans — minTokens 50', '', '', ''],
			['premature-abstraction', 'advisory', 'judgment', 'lightsout-defaults: code/architecture/architecture-decisions'],
			['abstracting before the third use', '', '', ''],
			['3 rule(s)', '1 blocking', '2 advisory, 0 off', '2 by code, 1 by judgment'],
		]);
	});

	test('--list answers the question without running a single check, and exits 0', async () => {
		const { context, exitCodes } = setupRuleList({ cwd: mkdtempSync(join(tmpdir(), 'lightsout-test-')) });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRunStandardsCheck).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([0]);
	});

	test("the repo's own config and path reach the ledger, so what prints is this repo's policy", async () => {
		const cwd = setupConsumerRepo({ git: false, config: { standardsChecks: { clone: 'off' } } });
		const { context } = setupRuleList({ cwd });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(listParams()?.config).toEqual(expect.objectContaining({ standardsChecks: { clone: 'off' } }));
		// the repo path travels too: the packages a listing is built from are the
		// ones this repo asked for, resolved against it
		expect(listParams()?.cwd).toBe(cwd);
	});

	test('a repo with no config still gets an answer — every rule at its default', async () => {
		const { context, logged } = setupRuleList({ cwd: mkdtempSync(join(tmpdir(), 'lightsout-test-')) });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// a missing config is tolerated here exactly as the run path tolerates it
		expect(listParams()?.config).toBeUndefined();
		expect(cellsOf({ logged })).toContainEqual(['multi-export', 'blocking', 'code', 'lightsout-defaults: code/style-guide/structure/one-export-per-file']);
	});

	test('a ledger that cannot be built stops the command before any check runs', async () => {
		const { context, exitCodes } = setupCheck();
		mockListStandardsRules.mockRejectedValue(new Error('standards package "acme" could not be loaded'));

		await expect(standardsCheckCommand(context)).rejects.toThrow('standards package "acme" could not be loaded');

		// a repo whose configured packages cannot load must not half-run: no check,
		// and no exit code claiming the repo came back clean
		expect(mockRunStandardsCheck).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([]);
	});

	test('a ledger that cannot be built fails --list too, rather than printing an empty table', async () => {
		const { context, logged } = setupRuleList({ cwd: mkdtempSync(join(tmpdir(), 'lightsout-test-')) });
		mockListStandardsRules.mockRejectedValue(new Error('standards package "acme" could not be loaded'));

		await expect(standardsCheckCommand(context)).rejects.toThrow('standards package "acme" could not be loaded');

		expect(logged).toStrictEqual([]);
	});

	test('with no selector both halves run — this is a standards check, and both halves are the check', async () => {
		const { context } = setupCheck({ args: [] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRunStandardsCheck).toHaveBeenCalled();
		expect(mockRunStandardsReview).toHaveBeenCalled();
	});

	test('--code-checks runs only the half code does', async () => {
		const { context } = setupCheck({ args: ['--code-checks'] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRunStandardsCheck).toHaveBeenCalled();
		expect(mockRunStandardsReview).not.toHaveBeenCalled();
	});

	test('--agent-review runs only the half an agent does', async () => {
		const { context } = setupCheck({ args: ['--agent-review'] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRunStandardsCheck).not.toHaveBeenCalled();
		expect(mockRunStandardsReview).toHaveBeenCalled();
	});

	test('naming both halves runs both, exactly as naming neither does', async () => {
		const { context } = setupCheck({ args: ['--code-checks', '--agent-review'] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// each flag names an actor to keep, so keeping both is not a contradiction
		expect(mockRunStandardsCheck).toHaveBeenCalled();
		expect(mockRunStandardsReview).toHaveBeenCalled();
	});

	test('a repo that configured nothing gets the default harness and the default bound', async () => {
		const { context } = setupCheck({ args: ['--agent-review'], cwd: setupUnconfiguredRepo() });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(reviewParams()).toEqual(expect.objectContaining({ timeoutMs: 60 * 60_000 }));
		expect(reviewParams()?.driver.name).toBe('claude-code');
	});

	test('a repo that never named its channels has them read off its own manifest', async () => {
		const { context } = setupCheck({ args: ['--agent-review'], cwd: setupUnconfiguredRepo({ dependencies: { react: '^19.0.0' } }) });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// the same answer the machine half reaches, so one repo is judged once
		expect(reviewParams()?.channels).toStrictEqual(['react']);
	});

	test('without a --path filter the review covers every source file in the repo', async () => {
		const { context } = setupCheck({ args: ['--agent-review'], cwd: setupUnconfiguredRepo() });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(reviewParams()?.files).toStrictEqual(['src/index.ts']);
	});

	test("the review's progress reaches the terminal as it reports it", async () => {
		const { context, logged } = setupCheck({ args: ['--agent-review'] });
		mockRunStandardsReview.mockImplementation(async ({ onProgress }) => {
			onProgress?.('reviewing 4 judgment rule(s) over 12 file(s)');

			return { findings: [], notes: [] };
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[0]).toBe('reviewing 4 judgment rule(s) over 12 file(s)');
	});

	test('review findings join the same stream, printed after the blocking work', async () => {
		const { context, logged } = setupCheck({
			args: [],
			findings: [finding({ rule: 'clone', severity: StandardsSeverity.Blocking, siteKey: 'clone:src/a.ts:1' })],
			reviewFindings: [finding({ rule: 'path-aliases', siteKey: 'path-aliases:src/a.ts', detail: 'a relative import in an aliased package' })],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(headingsOf({ logged })).toStrictEqual(['⚠ clone · 1 blocking', 'ℹ path-aliases · 1 advisory']);
	});

	test("the review's skip note prints under the same marker the check's notes use", async () => {
		const { context, logged } = setupCheck({ args: ['--agent-review'], reviewNotes: ['agent review skipped — agent invocation failed: spawn claude ENOENT'] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// a missing harness is a plain statement, never a failure
		expect(logged).toContain('ℹ agent review skipped — agent invocation failed: spawn claude ENOENT');
		expect(logged.some((line) => line.includes('clean — nothing blocking'))).toBe(true);
	});

	test('the command writes the merged stream itself, so one run leaves one report', async () => {
		const { context, cwd } = setupCheck({
			args: [],
			findings: [finding({ rule: 'clone', severity: StandardsSeverity.Blocking, siteKey: 'clone:src/a.ts:1' })],
			reviewFindings: [finding({ rule: 'path-aliases', siteKey: 'path-aliases:src/a.ts' })],
			notes: ['3 site(s) held back by the baseline'],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// the check never writes it — two writers to one file would race
		expect(checkParams()?.persist).toBe(false);

		const written = writtenReport({ cwd });

		expect(written?.path).toBe('.');
		expect(written?.findings.map((entry) => entry.rule)).toStrictEqual(['clone', 'path-aliases']);
		expect(written?.notes).toStrictEqual(['3 site(s) held back by the baseline']);
	});

	test("the review is bounded and scoped by the repo's own config, over the files the --path filter leaves", async () => {
		const cwd = setupConsumerRepo({
			git: false,
			config: { harness: 'codex', standardsChannels: ['react'], timeouts: { agentMinutes: 5 } },
		});
		const { context } = setupCheck({ args: ['--agent-review', '--path', 'src'], cwd });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		const params = mockRunStandardsReview.mock.calls[0]?.[0];

		expect(params?.driver.name).toBe('codex');
		// configured channels are taken as given — the same answer the machine half gets
		expect(params?.channels).toStrictEqual(['react']);
		expect(params?.timeoutMs).toBe(5 * 60_000);
		// and the scope is the subtree the flag named
		expect(params?.files).toStrictEqual(['src/index.js']);
	});

	test('a review-only run prints but writes nothing — the evidence file is the machine half’s', async () => {
		const { context, cwd, logged } = setupCheck({
			args: ['--agent-review'],
			reviewFindings: [finding({ rule: 'path-aliases', siteKey: 'path-aliases:src/a.ts' })],
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(writtenReport({ cwd })).toBe(undefined);
		// and it does not claim a report a reader could go open
		expect(logged.some((line) => line.startsWith('report: '))).toBe(false);
	});
});
