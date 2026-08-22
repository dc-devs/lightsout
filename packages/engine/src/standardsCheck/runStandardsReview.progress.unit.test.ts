import { describe, expect, jest, test } from '@jest/globals';
import { StandardsSeverity } from '#src/contracts/index.ts';
import type { Driver, DriverResult } from '#src/drivers/index.ts';
import { runStandardsReview } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPack, LoadedStandardsRule } from '#src/standardsPacks/index.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';

// What the caller hears while the review runs: the opening line, the heartbeat
// while the agent works, and the closing line. The findings themselves are the
// main suite's subject.

const judgmentRule = ({ id }: { id: string }): LoadedStandardsRule => ({
	id,
	set: 'code',
	documentPath: 'code/architecture/folder-structure',
	summary: 'a rule',
	prose: 'the argument for the rule',
	channel: 'base',
	checked: false,
	defaultSeverity: StandardsSeverity.Advisory,
	defaultSettings: {},
	fixturesPath: `/packages/acme/${id}/fixtures`,
});

const packOf = ({ ruleIds }: { ruleIds: string[] }): LoadedStandardsPack => ({
	name: 'acme',
	formatVersion: 1,
	rootPath: '/packages/acme',
	documents: [],
	rules: ruleIds.map((id) => judgmentRule({ id })),
});

/**
 * A stub harness that streams a Read of `filesRead` distinct files, then runs
 * on the fake clock for `runForMs` before answering — what the heartbeat is
 * for. With no `runForMs` it answers at once, on the real clock.
 */
const setupDriver = ({ result, filesRead = 0, runForMs }: { result: DriverResult; filesRead?: number; runForMs?: number }) => {
	if (runForMs !== undefined) {
		jest.useFakeTimers({ now: 0 });
	}

	const progress: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			for (let index = 0; index < filesRead; index += 1) {
				invocation.onEvent?.({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: `src/${index}.ts` } }] } });
			}

			if (runForMs !== undefined) {
				await jest.advanceTimersByTimeAsync(runForMs);
			}

			return result;
		},
	};

	return { driver, progress, onProgress: (message: string) => progress.push(message) };
};

describe('runStandardsReview progress', () => {
	test('the caller is told the review has started, who is reading, against how many rules, and roughly how long that takes', async () => {
		const { driver, progress, onProgress } = setupDriver({ result: { text: reviewReport(), exitCode: 0 } });

		await runStandardsReview({
			cwd: '/repo',
			driver,
			packs: [packOf({ ruleIds: ['common-placement', 'one-export'] })],
			channels: [],
			files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
			onProgress,
		});

		expect(progress[0]).toBe(
			'The agent review is now running. stub is reading your code against the 2 rules no automated check can judge. This usually takes a few minutes.',
		);
	});

	test('the caller is told when the review finished, how long it took, and what it found', async () => {
		const { driver, progress, onProgress } = setupDriver({
			result: { text: reviewReport([{ rule: 'common-placement', files: [{ path: 'src/a.ts' }], detail: 'moved too early' }]), exitCode: 0 },
		});

		await runStandardsReview({ cwd: '/repo', driver, packs: [packOf({ ruleIds: ['common-placement'] })], channels: [], files: ['src/a.ts'], onProgress });

		expect(progress.at(-1)).toMatch(/^✓ Agent review finished in \d+s — 1 advisory to look at$/);
	});

	test('a review that found more than one advisory says so in the plural', async () => {
		const { driver, progress, onProgress } = setupDriver({
			result: {
				text: reviewReport([
					{ rule: 'common-placement', files: [{ path: 'src/a.ts' }], detail: 'moved too early' },
					{ rule: 'one-export', files: [{ path: 'src/b.ts' }], detail: 'a second export' },
				]),
				exitCode: 0,
			},
		});

		await runStandardsReview({
			cwd: '/repo',
			driver,
			packs: [packOf({ ruleIds: ['common-placement', 'one-export'] })],
			channels: [],
			files: ['src/a.ts', 'src/b.ts'],
			onProgress,
		});

		expect(progress.at(-1)).toMatch(/^✓ Agent review finished in \d+s — 2 advisories to look at$/);
	});

	test('a skipped review still says how long the agent ran before it stopped', async () => {
		const { driver, progress, onProgress } = setupDriver({ result: { text: 'not a report', exitCode: 1 } });

		await runStandardsReview({ cwd: '/repo', driver, packs: [packOf({ ruleIds: ['common-placement'] })], channels: [], files: ['src/a.ts'], onProgress });

		expect(progress.at(-1)).toMatch(/^Agent review stopped after \d+s\.$/);
	});

	test('while the agent runs, the caller hears it is still going — with the tool calls seen on the harness stream', async () => {
		const { driver, progress, onProgress } = setupDriver({ result: { text: reviewReport(), exitCode: 0 }, filesRead: 2, runForMs: 30_000 });

		await runStandardsReview({
			cwd: '/repo',
			driver,
			packs: [packOf({ ruleIds: ['common-placement'] })],
			channels: [],
			files: ['src/a.ts'],
			timeoutMs: 60 * 60_000,
			onProgress,
		});

		// started → still running, with proof of life → finished: each line says
		// what is happening to the reader right now
		expect(progress).toStrictEqual([
			'The agent review is now running. stub is reading your code against the 1 rule no automated check can judge. This usually takes a few minutes.',
			'⏳ agent review still running · 30s · 2 files read so far',
			'✓ Agent review finished in 30s — nothing to report',
		]);
	});

	test('the heartbeat stops with the agent — a finished review prints no further lines', async () => {
		const { driver, progress, onProgress } = setupDriver({ result: { text: reviewReport(), exitCode: 0 }, runForMs: 30_000 });

		await runStandardsReview({ cwd: '/repo', driver, packs: [packOf({ ruleIds: ['common-placement'] })], channels: [], files: ['src/a.ts'], onProgress });
		jest.advanceTimersByTime(120_000);

		expect(progress.filter((line) => line.includes('still running'))).toHaveLength(1);
	});
});
