import { describe, expect, test } from '@jest/globals';
import { buildDirectWorkerInvocation } from '#src/agents/buildDirectWorkerInvocation.ts';

const base = { ticketRef: 'LO-70', ticketBody: '# Drain the backlog\n\nBuild the thing.' };

describe('buildDirectWorkerInvocation', () => {
	test('puts the role and the whole ticket in the system prompt, which is what the harness caches through', () => {
		const { systemPrompt } = buildDirectWorkerInvocation(base);

		expect(systemPrompt).toContain('# Role: Direct Worker');
		expect(systemPrompt).toContain('# Ticket LO-70');
		expect(systemPrompt).toContain('Build the thing.');
	});

	test('leaves the per-attempt half of the invocation empty when nothing has happened yet', () => {
		const { prompt } = buildDirectWorkerInvocation(base);

		expect(prompt).toBe('Remember: your entire final message must be exactly one JSON report object — nothing else.');
	});

	test('inlines the standards verbatim, because a rule the agent cannot read binds nothing', () => {
		const { systemPrompt } = buildDirectWorkerInvocation({ ...base, standards: 'Never use `any`.' });

		expect(systemPrompt).toContain('# Standards');
		expect(systemPrompt).toContain('Never use `any`.');
	});

	test('states granted commands as a grant, and says the engine runs the gates itself', () => {
		const { systemPrompt } = buildDirectWorkerInvocation({ ...base, allowedCommands: ['pnpm prisma migrate dev'] });

		expect(systemPrompt).toContain('# Granted commands\n\nYou may run these shell commands');
		expect(systemPrompt).toContain('- `pnpm prisma migrate dev`');
	});

	test('says nothing about granted commands when the repo grants none', () => {
		expect(buildDirectWorkerInvocation({ ...base, allowedCommands: [] }).systemPrompt).not.toContain('# Granted commands\n\nYou may run these shell commands');
	});

	test('carries a relayed answer in the per-attempt half, telling the worker to continue rather than start over', () => {
		const { prompt } = buildDirectWorkerInvocation({ ...base, answeredQuestion: { question: 'Which one?', answer: 'the second' } });

		expect(prompt).toContain('Which one?');
		expect(prompt).toContain('the second');
		expect(prompt).toContain('continue it in place');
	});

	test('carries the gate output and the changed files a fix re-invocation needs, and only those', () => {
		const { systemPrompt, prompt } = buildDirectWorkerInvocation({ ...base, errorContext: 'tsc: 3 errors', changedFiles: ['src/thing.ts'] });

		expect(prompt).toContain('# Previously changed files');
		expect(prompt).toContain('- src/thing.ts');
		expect(prompt).toContain('tsc: 3 errors');
		expect(systemPrompt).not.toContain('tsc: 3 errors');
	});

	test('says nothing about standards when the repo publishes none', () => {
		const { systemPrompt } = buildDirectWorkerInvocation(base);

		expect(systemPrompt).not.toContain('# Standards');
	});

	test('omits the changed-files section when the list is present but empty', () => {
		const { prompt } = buildDirectWorkerInvocation({ ...base, changedFiles: [], errorContext: 'tsc: 3 errors' });

		expect(prompt).not.toContain('# Previously changed files');
	});

	test('gives every granted command its own backticked bullet', () => {
		const { systemPrompt } = buildDirectWorkerInvocation({ ...base, allowedCommands: ['pnpm db:migrate', 'pnpm codegen'] });

		expect(systemPrompt).toContain('- `pnpm db:migrate`\n- `pnpm codegen`');
	});

	test('orders the system prompt role, ticket, standards, then granted commands, each behind a rule', () => {
		const { systemPrompt } = buildDirectWorkerInvocation({ ...base, standards: 'Never use `any`.', allowedCommands: ['pnpm db:migrate'] });

		expect(systemPrompt.startsWith('# Role: Direct Worker')).toBe(true);
		expect(systemPrompt).toContain('\n\n---\n\n# Ticket LO-70');
		expect(systemPrompt.indexOf('\n\n---\n\n# Standards')).toBeLessThan(systemPrompt.indexOf('\n\n---\n\n# Granted commands'));
	});

	test('orders the per-attempt half answer, changed files, gate output, then the report reminder', () => {
		const { prompt } = buildDirectWorkerInvocation({
			...base,
			answeredQuestion: { question: 'Which one?', answer: 'the second' },
			changedFiles: ['src/thing.ts'],
			errorContext: 'tsc: 3 errors',
		});

		expect(prompt.indexOf('# Your question, answered')).toBeLessThan(prompt.indexOf('# Previously changed files'));
		expect(prompt.indexOf('# Previously changed files')).toBeLessThan(prompt.indexOf('# Verification failure'));
		expect(prompt.endsWith('Remember: your entire final message must be exactly one JSON report object — nothing else.')).toBe(true);
	});

	test('keeps the system prompt byte-identical across a fix re-invocation, so the harness cache still hits', () => {
		const stable = { ...base, standards: 'Never use `any`.', allowedCommands: ['pnpm db:migrate'] };

		const first = buildDirectWorkerInvocation(stable);
		const retry = buildDirectWorkerInvocation({
			...stable,
			changedFiles: ['src/thing.ts'],
			errorContext: 'tsc: 3 errors',
			answeredQuestion: { question: 'Which one?', answer: 'the second' },
		});

		expect(retry.systemPrompt).toBe(first.systemPrompt);
	});
});
