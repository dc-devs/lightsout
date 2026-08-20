import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { standardsCheckCommand } from '#src/cli/standardsCheckCommand.ts';
import { type LightsoutConfig, type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Mocked Imports
// -------------------------
// Both halves of the check are other modules' entry points with their own tests.
// What this file pins is the shape of the terminal output: each half under its
// own heading, the fast half's answer on screen before the slow half starts,
// and what a reader is told while the agent works.

interface RunStandardsCheckParams {
	cwd: string;
	onProgress?: (message: string) => void;
}

const mockRunStandardsCheck = jest.fn<(params: RunStandardsCheckParams) => Promise<{ findings: StandardsFinding[]; notes: string[] }>>();

interface ReviewStandardsParams {
	cwd: string;
	config?: LightsoutConfig;
	path?: string;
	onProgress?: (message: string) => void;
}

const mockReviewStandards = jest.fn<(params: ReviewStandardsParams) => Promise<{ findings: StandardsFinding[]; notes: string[] }>>();

jest.mock('#src/standardsCheck/index.ts', () => ({
	runStandardsCheck: (params: RunStandardsCheckParams) => mockRunStandardsCheck(params),
	listStandardsRules: () => Promise.resolve([]),
	writeStandardsSnapshot: () => Promise.resolve(),
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
	args = [],
	check = {},
	review = {},
	config,
}: {
	args?: string[];
	/** What the machine half returns, and the progress it reports on the way. */
	check?: { findings?: StandardsFinding[]; notes?: string[]; progress?: string[] };
	/** What the agent half returns, and the progress it reports on the way. */
	review?: { findings?: StandardsFinding[]; notes?: string[]; progress?: string[] };
	/** The config the repo carries on disk — given one, the cwd is a repo holding it. */
	config?: Record<string, unknown>;
} = {}) => {
	const captured = captureCommandOutput();
	const cwd = config === undefined ? mkdtempSync(join(tmpdir(), 'lightsout-test-')) : setupConsumerRepo({ git: false, config });

	mockRunStandardsCheck.mockImplementation(async ({ onProgress }) => {
		for (const message of check.progress ?? []) {
			onProgress?.(message);
		}

		return { findings: check.findings ?? [], notes: check.notes ?? [] };
	});

	mockReviewStandards.mockImplementation(async ({ onProgress }) => {
		for (const message of review.progress ?? []) {
			onProgress?.(message);
		}

		return { findings: review.findings ?? [], notes: review.notes ?? [] };
	});

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, ...captured };
};

const codeChecksHeading = 'Code checks  ·  deterministic — the same answer every run';
const agentReviewHeading = 'Agent review  ·  judgment rules, read by claude-code';

/** The section headings, in the order they were printed. */
const sectionsOf = ({ logged }: { logged: string[] }) => logged.filter((line) => line.startsWith('Code checks') || line.startsWith('Agent review'));

describe('standardsCheckCommand sections', () => {
	test('each half runs under its own heading, in the order they run', async () => {
		const { context, logged } = setupCheck();

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(sectionsOf({ logged })).toStrictEqual([codeChecksHeading, agentReviewHeading]);
	});

	test('a half that is switched off prints no heading either', async () => {
		const { context, logged } = setupCheck({ args: ['--code-checks'] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(sectionsOf({ logged })).toStrictEqual([codeChecksHeading]);
	});

	test("the check's progress prints under its heading as the check reports it, ahead of any result", async () => {
		const { context, logged } = setupCheck({
			args: ['--code-checks'],
			check: { progress: ['checking 12 source file(s)', 'tier 0 (names): done'], findings: [finding()] },
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged.slice(0, 4)).toStrictEqual(['', codeChecksHeading, '  checking 12 source file(s)', '  tier 0 (names): done']);
	});

	test("the code checks' findings are on screen before the agent review starts — a reader waiting on the agent already has the deterministic answer", async () => {
		const { context, logged } = setupCheck({
			check: { findings: [finding({ rule: 'clone', severity: StandardsSeverity.Blocking, siteKey: 'clone:src/a.ts:1' })] },
			review: { findings: [finding({ rule: 'path-aliases', siteKey: 'path-aliases:src/a.ts' })] },
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged.indexOf('⚠ clone · 1 blocking')).toBeLessThan(logged.indexOf(agentReviewHeading));
		expect(logged.indexOf(agentReviewHeading)).toBeLessThan(logged.indexOf('ℹ path-aliases · 1 advisory'));
	});

	test("the check's notes print under their own marker, inside its section", async () => {
		const { context, logged } = setupCheck({ args: ['--code-checks'], check: { findings: [finding()], notes: ['3 site(s) held back by the baseline'] } });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('  ℹ 3 site(s) held back by the baseline');
	});

	test('a section that found nothing and has nothing to note says so, rather than leaving an empty gap', async () => {
		const { context, logged } = setupCheck({ args: ['--code-checks'] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('  ✓ nothing found');
	});

	test('the agent review names the configured harness and says what a reader is waiting on before the agent is spent', async () => {
		const { context, logged } = setupCheck({
			args: ['--agent-review'],
			config: { gates: { check: 'true', test: 'true', 'test-coverage': false }, harness: 'codex' },
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		const heading = logged.indexOf('Agent review  ·  judgment rules, read by codex');

		expect(heading).toBeGreaterThan(-1);
		expect(logged[heading + 1]).toBe('  Rules no code can check: one agent reads the files in a single pass and reports what it sees.');
		expect(logged[heading + 2]).toBe(
			'  Advisory only — it never blocks. Expect minutes, not seconds; a line prints while it works so you can tell it is alive.',
		);
	});

	test("the review's progress prints under its section as the review reports it", async () => {
		const { context, logged } = setupCheck({
			args: ['--agent-review'],
			review: { progress: ['reading 4 judgment rule(s) against 12 file(s)', 'still working — 30s elapsed · 5 tool call(s) so far'] },
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('  reading 4 judgment rule(s) against 12 file(s)');
		expect(logged).toContain('  still working — 30s elapsed · 5 tool call(s) so far');
	});

	test("a skipped review states why under the check's note marker, and is not passed off as a clean review", async () => {
		const { context, logged } = setupCheck({
			args: ['--agent-review'],
			review: { notes: ['agent review skipped — agent invocation failed: spawn claude ENOENT'] },
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// a missing harness is a plain statement, never a failure
		expect(logged).toContain('  ℹ agent review skipped — agent invocation failed: spawn claude ENOENT');
		expect(logged).not.toContain('  ✓ nothing found');
		expect(logged.some((line) => line.includes('clean — nothing blocking'))).toBe(true);
	});
});
