import { describe, expect, test } from '@jest/globals';
import { ActivityMark } from '#src/contracts/activity/ActivityMark.ts';

const setupLevelStart = () => {
	const lineWithoutLevel = {
		kind: 'level-start',
		id: 'a-plan-folder',
		label: 'a-plan-folder',
		at: '2026-09-17T09:00:00.000Z',
	};

	const line = { ...lineWithoutLevel, level: 'plan' };

	return { line, lineWithoutLevel };
};

const setupProcessCost = () => {
	const base = {
		kind: 'harness-process',
		levelId: 'level-1',
		harness: 'claude',
		spawn: 1,
		reemit: false,
		startedAt: '2026-09-17T09:00:00.000Z',
		endedAt: '2026-09-17T09:01:00.000Z',
		endReason: 'timed-out',
	};

	const tokensOnly = { ...base, usage: { inputTokens: 1200, outputTokens: 340 } };
	const zeroCost = { ...base, endReason: 'completed', usage: { inputTokens: 1200, outputTokens: 340, costUsd: 0 } };

	return { tokensOnly, zeroCost };
};

const setupSpawns = () => {
	const base = {
		kind: 'harness-process',
		levelId: 'level-1',
		harness: 'claude',
		model: 'claude-opus-5',
		startedAt: '2026-09-17T09:00:00.000Z',
		endedAt: '2026-09-17T09:01:00.000Z',
		endReason: 'completed',
	};

	const roleAttempt = { ...base, effort: 'high', spawn: 1, reemit: false };
	const reemitAttempt = { ...base, effort: 'low', spawn: 2, reemit: true };
	const noEffortAttempt = { ...base, spawn: 3, reemit: false };

	return { roleAttempt, reemitAttempt, noEffortAttempt };
};

describe('ActivityMark', () => {
	test('a level-start line parses, and one missing its level kind is rejected', () => {
		const { line, lineWithoutLevel } = setupLevelStart();

		const parsed = ActivityMark.parse(line);
		const withoutLevel = ActivityMark.safeParse(lineWithoutLevel);

		expect(parsed).toStrictEqual({
			kind: 'level-start',
			id: 'a-plan-folder',
			level: 'plan',
			label: 'a-plan-folder',
			at: '2026-09-17T09:00:00.000Z',
		});
		// a mark that cannot say which level it opened would be nested under a
		// guessed default and put a row at the wrong depth of the report
		expect(withoutLevel.success).toBe(false);
	});

	test('a process mark with no cost parses with cost absent, and a zero cost stays a zero', () => {
		const { tokensOnly, zeroCost } = setupProcessCost();

		const parsed = [tokensOnly, zeroCost].map((line) => ActivityMark.parse(line));

		// a process killed at its ceiling has the tokens its messages streamed and
		// no cost at all — cost is absent, never a zero standing in for silence
		expect(parsed[0]).toStrictEqual({
			kind: 'harness-process',
			levelId: 'level-1',
			harness: 'claude',
			spawn: 1,
			reemit: false,
			startedAt: '2026-09-17T09:00:00.000Z',
			endedAt: '2026-09-17T09:01:00.000Z',
			endReason: 'timed-out',
			usage: { inputTokens: 1200, outputTokens: 340 },
		});
		// a harness that stated it spent nothing keeps its stated zero
		expect(parsed[1]).toStrictEqual({
			kind: 'harness-process',
			levelId: 'level-1',
			harness: 'claude',
			spawn: 1,
			reemit: false,
			startedAt: '2026-09-17T09:00:00.000Z',
			endedAt: '2026-09-17T09:01:00.000Z',
			endReason: 'completed',
			usage: { inputTokens: 1200, outputTokens: 340, costUsd: 0 },
		});
	});

	test('two spawns of one request parse as separate marks carrying their spawn number, re-emit flag and effort', () => {
		const { roleAttempt, reemitAttempt, noEffortAttempt } = setupSpawns();

		const parsed = [roleAttempt, reemitAttempt, noEffortAttempt].map((line) => ActivityMark.parse(line));

		// a request re-run after a malformed answer reads as several rows rather
		// than as one expensive agent: the numbers rise and the re-emit flag says
		// which row was the answer thrown away
		expect(parsed).toStrictEqual([
			{
				kind: 'harness-process',
				levelId: 'level-1',
				harness: 'claude',
				model: 'claude-opus-5',
				effort: 'high',
				spawn: 1,
				reemit: false,
				startedAt: '2026-09-17T09:00:00.000Z',
				endedAt: '2026-09-17T09:01:00.000Z',
				endReason: 'completed',
			},
			{
				kind: 'harness-process',
				levelId: 'level-1',
				harness: 'claude',
				model: 'claude-opus-5',
				effort: 'low',
				spawn: 2,
				reemit: true,
				startedAt: '2026-09-17T09:00:00.000Z',
				endedAt: '2026-09-17T09:01:00.000Z',
				endReason: 'completed',
			},
			// a spawn with no effort set carries none — the harness's own default is
			// not something the record may invent a name for
			{
				kind: 'harness-process',
				levelId: 'level-1',
				harness: 'claude',
				model: 'claude-opus-5',
				spawn: 3,
				reemit: false,
				startedAt: '2026-09-17T09:00:00.000Z',
				endedAt: '2026-09-17T09:01:00.000Z',
				endReason: 'completed',
			},
		]);
	});
});
