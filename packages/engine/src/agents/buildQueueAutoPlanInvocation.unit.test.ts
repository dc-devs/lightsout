import { describe, expect, test } from '@jest/globals';
import { buildQueueAutoPlanInvocation } from '#src/agents/buildQueueAutoPlanInvocation.ts';

const base = {
	ticketRef: 'LO-70',
	ticketTitle: 'Drain the backlog',
	ticketBody: 'Build the thing.',
	engineCli: 'node /plugin/dist/cli.mjs',
	planAddress: 'lo-7-search/002-search-basics',
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

	test('buildQueueAutoPlanInvocation: names the plan address the engine chose', () => {
		const { prompt } = buildQueueAutoPlanInvocation(base);

		expect(prompt).toContain('lo-7-search/002-search-basics');
		expect(prompt).toContain('.lightsout/tickets/lo-7-search/plans/002-search-basics');
		expect(prompt).toMatch(/--name/);
	});

	test("buildQueueAutoPlanInvocation: the prompt names the plan's folder under its ticket", () => {
		const { prompt } = buildQueueAutoPlanInvocation(base);

		expect(prompt).toContain('.lightsout/tickets/lo-7-search/plans/002-search-basics');
		expect(prompt).not.toContain('.lightsout/plans/');
	});

	test('puts the plan address after the engine invocation, so the session reads the granted command prefix first', () => {
		const { prompt } = buildQueueAutoPlanInvocation(base);

		const headings = prompt.split('\n\n').filter((section) => section.startsWith('# '));

		expect(headings.slice(0, 2)).toEqual(['# The engine invocation', '# The plan you are planning']);
	});

	test('leaves the ticket record to the engine, so the session never adds the plan itself', () => {
		const { prompt } = buildQueueAutoPlanInvocation(base);

		expect(prompt).toMatch(/never run[^\n]*`work-order add-plan`/);
		expect(prompt).toMatch(/any other `work-order` subcommand/);
	});

	test('leaves no dual spelling behind: the record sentence names work-order and never the old ticket command word', () => {
		const { prompt } = buildQueueAutoPlanInvocation(base);

		const recordSentence = prompt.split('\n\n').find((section) => section.includes('already added this plan'));

		expect(recordSentence).toBe(
			"The engine has already added this plan to the ticket's record, so never run `work-order add-plan` or any other `work-order` subcommand.",
		);
	});

	test('forbids the two things only the queue may do: asking a question directly, and shipping', () => {
		const { systemPrompt } = buildQueueAutoPlanInvocation(base);

		expect(systemPrompt).toContain('Never ask a question directly');
		expect(systemPrompt).toContain('Never run `lightsout ship`');
	});

	test('forbids the third thing only the queue may do: running the implement subcommand', () => {
		const { systemPrompt } = buildQueueAutoPlanInvocation(base);

		expect(systemPrompt).toContain('Never implement');
		expect(systemPrompt).toMatch(/[Nn]ever run[^\n]*implement/);
		expect(systemPrompt).toContain('lightsout:implement');
	});

	test('tells the session its job ends when the plan is published, not when a build finishes', () => {
		const { systemPrompt } = buildQueueAutoPlanInvocation(base);

		expect(systemPrompt).toMatch(/job ends[^\n]*publish/i);
		expect(systemPrompt).toContain('published to the ticket');
		expect(systemPrompt).not.toContain('the plan was implemented and its run passed');
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
