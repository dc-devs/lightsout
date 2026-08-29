import { describe, expect, test } from '@jest/globals';
import { RelayQuestion } from '#src/contracts/index.ts';

const question = {
	ticket: 'LO-70',
	title: 'Drain the backlog',
	question: 'Which one?',
	askedAt: '2026-01-01T00:00:00.000Z',
};

describe('RelayQuestion', () => {
	test('accepts the file the queue writes, so a reader can act on it without opening the tracker', () => {
		expect(RelayQuestion.parse(question)).toStrictEqual(question);
	});

	test('refuses a question with no ticket behind it — an answer nobody can route is an answer nobody can give', () => {
		expect(RelayQuestion.safeParse({ ...question, ticket: undefined }).success).toBe(false);
	});

	test('refuses a file with no timestamp, because how stale a question is decides whether it is worth answering', () => {
		expect(RelayQuestion.safeParse({ ...question, askedAt: undefined }).success).toBe(false);
	});
});
