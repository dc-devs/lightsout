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
const agentReviewHeading = 'Agent review';

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

	for (const { findings, expected } of [
		{ findings: [], expected: 'nothing found' },
		{ findings: [finding()], expected: '1 advisory' },
		{ findings: [finding(), finding({ siteKey: 'size:two' })], expected: '2 advisories' },
		{ findings: [finding({ rule: 'clone', severity: StandardsSeverity.Blocking, siteKey: 'clone:1' })], expected: '1 blocking' },
		{ findings: [finding({ rule: 'clone', severity: StandardsSeverity.Blocking, siteKey: 'clone:1' }), finding()], expected: '1 blocking, 1 advisory' },
	]) {
		test(`the code checks close with a finish line saying how long they took and what they found: ${expected}`, async () => {
			const { context, logged } = setupCheck({ args: ['--code-checks'], check: { findings } });

			await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

			expect(logged.find((line) => line.includes('Code checks finished'))).toMatch(new RegExp(`^  ✓ Code checks finished in \\d+s — ${expected}$`));
		});
	}

	test('the agent review adds nothing of its own under the heading — the review narrates itself, from started to finished', async () => {
		const { context, logged } = setupCheck({
			args: ['--agent-review'],
			review: {
				progress: [
					'The agent review is now running. claude-code is reading your code against the 62 rules no automated check can judge. This usually takes a few minutes.',
					'⏳ agent review still running · 30s · 12 files read so far',
					'✓ Agent review finished in 4m 12s — nothing to report',
				],
			},
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		const heading = logged.indexOf(agentReviewHeading);

		expect(heading).toBeGreaterThan(-1);
		expect(logged.slice(heading + 1, heading + 4)).toStrictEqual([
			'  The agent review is now running. claude-code is reading your code against the 62 rules no automated check can judge. This usually takes a few minutes.',
			'  ⏳ agent review still running · 30s · 12 files read so far',
			'  ✓ Agent review finished in 4m 12s — nothing to report',
		]);
	});

	test("a skipped review states why under the check's note marker — a plain statement, never a failure", async () => {
		const { context, logged } = setupCheck({
			args: ['--agent-review'],
			review: { notes: ['agent review skipped — agent invocation failed: spawn claude ENOENT'] },
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('  ℹ agent review skipped — agent invocation failed: spawn claude ENOENT');
		expect(logged.some((line) => line.includes('clean — nothing blocking'))).toBe(true);
	});
});
