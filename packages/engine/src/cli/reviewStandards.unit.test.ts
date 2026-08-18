import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { reviewStandards } from '@/cli/reviewStandards';
import type { LightsoutConfig, StandardsFinding } from '@/contracts';
import type { Driver } from '@/drivers';

// Mocked Imports
// -------------------------
// The review runner spawns a harness and has its own tests; what this resolver
// owns is everything it hands over — packages, channels, file scope, driver,
// time bound — all observable with the runner stubbed.

interface RunStandardsReviewParams {
	cwd: string;
	driver: Driver;
	packages: unknown[];
	channels: string[];
	files: string[];
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

const mockRunStandardsReview = jest.fn<(params: RunStandardsReviewParams) => Promise<{ findings: StandardsFinding[]; notes: string[] }>>();

jest.mock('@/standardsCheck', () => ({
	runStandardsReview: (params: RunStandardsReviewParams) => mockRunStandardsReview(params),
}));
jest.mock('@/standardsPackages', () => ({ resolveStandardsPackages: async () => [] }));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** A repo the review reads its own answers off: source files, and a manifest whose dependencies decide the channels. */
const setupRepo = ({ dependencies = {}, sources = ['src/index.ts'] }: { dependencies?: Record<string, string>; sources?: string[] } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-review-'));

	for (const source of sources) {
		mkdirSync(join(cwd, source, '..'), { recursive: true });
		writeFileSync(join(cwd, source), 'export const one = 1;\n');
	}

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', dependencies }));
	mockRunStandardsReview.mockResolvedValue({ findings: [], notes: [] });

	return cwd;
};

const reviewParams = () => mockRunStandardsReview.mock.calls[0]?.[0];

describe('reviewStandards', () => {
	test('a repo that configured nothing gets the default harness and the default bound', async () => {
		const cwd = setupRepo();

		await reviewStandards({ cwd });

		expect(reviewParams()).toEqual(expect.objectContaining({ timeoutMs: 60 * 60_000 }));
		expect(reviewParams()?.driver.name).toBe('claude-code');
	});

	test('a repo that never named its channels has them read off its own manifest', async () => {
		const cwd = setupRepo({ dependencies: { react: '^19.0.0' } });

		await reviewStandards({ cwd });

		// the same answer the machine half reaches, so one repo is judged once
		expect(reviewParams()?.channels).toStrictEqual(['react']);
	});

	test('without a path filter the review covers every source file in the repo', async () => {
		const cwd = setupRepo();

		await reviewStandards({ cwd });

		expect(reviewParams()?.files).toStrictEqual(['src/index.ts']);
	});

	test("the review is bounded and scoped by the repo's own config, over the files the path filter leaves", async () => {
		const cwd = setupRepo({ sources: ['src/index.ts', 'scripts/build.ts'] });
		const config: LightsoutConfig = { gates, harness: 'codex', standardsChannels: ['react'], timeouts: { agentMinutes: 5 } };

		await reviewStandards({ cwd, config, path: 'src' });

		expect(reviewParams()?.driver.name).toBe('codex');
		// configured channels are taken as given — the same answer the machine half gets
		expect(reviewParams()?.channels).toStrictEqual(['react']);
		expect(reviewParams()?.timeoutMs).toBe(5 * 60_000);
		// and the scope is the subtree the caller named
		expect(reviewParams()?.files).toStrictEqual(['src/index.ts']);
	});

	test("the runner's progress reaches the terminal as it reports it", async () => {
		const cwd = setupRepo();
		const { logged } = captureCommandOutput();

		mockRunStandardsReview.mockImplementation(async ({ onProgress }) => {
			onProgress?.('reviewing 4 judgment rule(s) over 12 file(s)');

			return { findings: [], notes: [] };
		});

		await reviewStandards({ cwd });

		expect(logged).toStrictEqual(['reviewing 4 judgment rule(s) over 12 file(s)']);
	});

	test("the runner's answer comes back whole — findings and notes alike", async () => {
		const cwd = setupRepo();
		const skipNote = 'agent review skipped — agent invocation failed: spawn claude ENOENT';

		mockRunStandardsReview.mockResolvedValue({ findings: [], notes: [skipNote] });

		await expect(reviewStandards({ cwd })).resolves.toStrictEqual({ findings: [], notes: [skipNote] });
	});
});
