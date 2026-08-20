import { describe, expect, jest, test } from '@jest/globals';
import { StandardsSeverity } from '#src/contracts/index.ts';
import type { Driver, DriverResult } from '#src/drivers/index.ts';
import { runStandardsReview } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPackage, LoadedStandardsRule } from '#src/standardsPackages/index.ts';
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

const packageOf = ({ ruleIds }: { ruleIds: string[] }): LoadedStandardsPackage => ({
	name: 'acme',
	formatVersion: 1,
	rootPath: '/packages/acme',
	documents: [],
	rules: ruleIds.map((id) => judgmentRule({ id })),
});

/**
 * A stub harness that streams `toolCallEvents` tool calls, then runs on the
 * fake clock for `runForMs` before answering — what the heartbeat is for. With
 * no `runForMs` it answers at once, on the real clock.
 */
const setupDriver = ({ result, toolCallEvents = 0, runForMs }: { result: DriverResult; toolCallEvents?: number; runForMs?: number }) => {
	if (runForMs !== undefined) {
		jest.useFakeTimers({ now: 0 });
	}

	const progress: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			for (let index = 0; index < toolCallEvents; index += 1) {
				invocation.onEvent?.({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } });
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
	test('the caller is told what the review covers before an agent is spent on it', async () => {
		const { driver, progress, onProgress } = setupDriver({ result: { text: reviewReport(), exitCode: 0 } });

		await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ ruleIds: ['common-placement', 'one-export'] })],
			channels: [],
			files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
			onProgress,
		});

		expect(progress[0]).toBe('reading 2 judgment rule(s) against 3 file(s)');
	});

	test('the caller is told when the review finished, how long it took, and what it found', async () => {
		const { driver, progress, onProgress } = setupDriver({
			result: { text: reviewReport([{ rule: 'common-placement', files: [{ path: 'src/a.ts' }], detail: 'moved too early' }]), exitCode: 0 },
		});

		await runStandardsReview({ cwd: '/repo', driver, packages: [packageOf({ ruleIds: ['common-placement'] })], channels: [], files: ['src/a.ts'], onProgress });

		expect(progress.at(-1)).toMatch(/^done in \d+s — 1 finding\(s\)$/);
	});

	test('a skipped review still says how long the agent ran before it stopped', async () => {
		const { driver, progress, onProgress } = setupDriver({ result: { text: 'not a report', exitCode: 1 } });

		await runStandardsReview({ cwd: '/repo', driver, packages: [packageOf({ ruleIds: ['common-placement'] })], channels: [], files: ['src/a.ts'], onProgress });

		expect(progress.at(-1)).toMatch(/^stopped after \d+s$/);
	});

	test('while the agent runs, the caller hears it is still going — with the tool calls seen on the harness stream', async () => {
		const { driver, progress, onProgress } = setupDriver({ result: { text: reviewReport(), exitCode: 0 }, toolCallEvents: 2, runForMs: 30_000 });

		await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ ruleIds: ['common-placement'] })],
			channels: [],
			files: ['src/a.ts'],
			timeoutMs: 60 * 60_000,
			onProgress,
		});

		// the bound is stated up front, once — a reader knows how long "still working" can last
		expect(progress).toStrictEqual([
			'reading 1 judgment rule(s) against 1 file(s) — bounded at 60m00s',
			'still working — 30s elapsed · 2 tool call(s) so far',
			'done in 30s — 0 finding(s)',
		]);
	});

	test('the heartbeat stops with the agent — a finished review prints no further lines', async () => {
		const { driver, progress, onProgress } = setupDriver({ result: { text: reviewReport(), exitCode: 0 }, runForMs: 30_000 });

		await runStandardsReview({ cwd: '/repo', driver, packages: [packageOf({ ruleIds: ['common-placement'] })], channels: [], files: ['src/a.ts'], onProgress });
		jest.advanceTimersByTime(120_000);

		expect(progress.filter((line) => line.includes('still working'))).toHaveLength(1);
	});
});
