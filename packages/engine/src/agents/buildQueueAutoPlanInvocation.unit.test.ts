import { describe, expect, test } from '@jest/globals';
import { buildQueueAutoPlanInvocation } from '#src/agents/buildQueueAutoPlanInvocation.ts';

const base = {
	ticketRef: 'LO-70',
	ticketTitle: 'Drain the backlog',
	ticketBody: 'Build the thing.',
	engineCli: 'node /plugin/dist/cli.mjs',
};

describe('buildQueueAutoPlanInvocation', () => {
	test('sends the session to the auto-plan skill rather than re-implementing what it does', () => {
		const { systemPrompt } = buildQueueAutoPlanInvocation(base);

		expect(systemPrompt).toContain('lightsout:auto-plan');
		expect(systemPrompt).toContain('# Ticket LO-70: Drain the backlog');
		expect(systemPrompt).toContain('Build the thing.');
	});

	test('states the exact invocation the session was granted, so instruction and grant name one command', () => {
		const { prompt } = buildQueueAutoPlanInvocation(base);

		expect(prompt).toContain('`node /plugin/dist/cli.mjs <subcommand>`');
	});

	test('forbids the two things only the queue may do: asking a question directly, and shipping', () => {
		const { systemPrompt } = buildQueueAutoPlanInvocation(base);

		expect(systemPrompt).toContain('Never ask a question directly');
		expect(systemPrompt).toContain('Never run `lightsout ship`');
	});

	test('tells a re-invoked session the worktree already holds its own earlier work', () => {
		const { prompt } = buildQueueAutoPlanInvocation({ ...base, answeredQuestion: { question: 'Which one?', answer: 'the second' } });

		expect(prompt).toContain('Which one?');
		expect(prompt).toContain('the second');
		expect(prompt).toContain('continue from there');
	});

	test('leaves the answered-question section out entirely on a first invocation', () => {
		expect(buildQueueAutoPlanInvocation(base).prompt).not.toContain('# Your question, answered');
	});

	test.each<{ label: string; answeredQuestion?: { question: string; answer: string } }>([
		{ label: 'a first invocation' },
		{ label: 'a re-invocation carrying an answer', answeredQuestion: { question: 'Which one?', answer: 'the second' } },
	])('closes $label with the report reminder, so the last thing the session reads is the shape of its reply', ({ answeredQuestion }) => {
		const { prompt } = buildQueueAutoPlanInvocation({ ...base, answeredQuestion });

		const closingSection = prompt.split('\n\n').at(-1);

		expect(closingSection).toBe('Remember: your entire final message must be exactly one JSON report object — nothing else.');
	});
});
