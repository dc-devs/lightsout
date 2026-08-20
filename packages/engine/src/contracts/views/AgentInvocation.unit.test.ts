import { describe, expect, test } from '@jest/globals';
import { AgentInvocation, AgentUsage } from '#src/contracts/index.ts';

const setupInvocation = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const line: Record<string, unknown> = {
		at: '2026-01-01T00:00:00.000Z',
		step: 'implement',
		inputTokens: 10,
		outputTokens: 100,
		cacheReadTokens: 880,
		cacheCreationTokens: 110,
		costUsd: 0.5,
		...extra,
	};

	if (omit) {
		delete line[omit];
	}

	return { line };
};

describe('AgentInvocation', () => {
	test('a minimal line parses to the usage envelope plus when and which step — no optional is invented', () => {
		const { line } = setupInvocation();

		const parsed = AgentInvocation.parse(line);

		expect(parsed).toStrictEqual({
			at: '2026-01-01T00:00:00.000Z',
			step: 'implement',
			inputTokens: 10,
			outputTokens: 100,
			cacheReadTokens: 880,
			cacheCreationTokens: 110,
			costUsd: 0.5,
		});
	});

	test('at and step are each required — a line the ledger cannot attribute is not an invocation', () => {
		for (const field of ['at', 'step']) {
			const { line } = setupInvocation({ omit: field });

			// per-step cost is summed by grouping on step, and the run timeline orders on at
			expect(AgentInvocation.safeParse(line).success).toBe(false);
		}
	});

	test('the inherited usage counters stay required — extending adds fields, it does not relax them', () => {
		for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'costUsd']) {
			const { line } = setupInvocation({ omit: field });

			expect(AgentInvocation.safeParse(line).success).toBe(false);
		}
	});

	test('a bare usage envelope is not a ledger line — the two provenance fields are what separate the contracts', () => {
		const { line } = setupInvocation();
		const bare = { inputTokens: 10, outputTokens: 100, cacheReadTokens: 880, cacheCreationTokens: 110, costUsd: 0.5 };

		const parsed = AgentInvocation.safeParse(bare);

		expect(parsed.success).toBe(false);
		// the same fields still satisfy the shape the driver reports
		expect(AgentUsage.safeParse(bare).success).toBe(true);
		expect(AgentUsage.safeParse(line).success).toBe(true);
	});

	test('a fully populated line carries the harness attribution through parsing intact', () => {
		const { line } = setupInvocation({ extra: { model: 'claude-opus-5', effort: 'high' } });

		const parsed = AgentInvocation.parse(line);

		expect(parsed).toStrictEqual({
			at: '2026-01-01T00:00:00.000Z',
			step: 'implement',
			inputTokens: 10,
			outputTokens: 100,
			cacheReadTokens: 880,
			cacheCreationTokens: 110,
			costUsd: 0.5,
			model: 'claude-opus-5',
			effort: 'high',
		});
	});

	test('effort accepts every level of the shared vocabulary', () => {
		for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
			const { line } = setupInvocation({ extra: { effort } });

			expect(AgentInvocation.parse(line).effort).toBe(effort);
		}
	});

	test('an effort only one harness understands is refused — the enum is closed', () => {
		for (const effort of ['none', 'minimal']) {
			const { line } = setupInvocation({ extra: { effort } });

			// Codex accepts both; a value that silently does nothing on the other harness
			// must not reach a reader as a portable level
			expect(AgentInvocation.safeParse(line).success).toBe(false);
		}
	});

	test('step is an open string — a supervisor consultation is recorded under its suffixed id', () => {
		const { line } = setupInvocation({ extra: { step: 'implement-supervisor' } });

		const parsed = AgentInvocation.parse(line);

		// the suffix is how a consultation is folded into the step it served
		expect(parsed.step).toBe('implement-supervisor');
	});

	test('model is an open string — a harness naming a model the engine has never heard of still parses', () => {
		const { line } = setupInvocation({ extra: { model: 'some-future-model' } });

		const parsed = AgentInvocation.parse(line);

		expect(parsed.model).toBe('some-future-model');
	});

	test('a zero-cost invocation parses — the counters survive their own falsy values', () => {
		const { line } = setupInvocation({
			extra: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 },
		});

		const parsed = AgentInvocation.parse(line);

		// a driver that reports no spend still wrote a line the ledger counts
		expect(parsed).toStrictEqual({
			at: '2026-01-01T00:00:00.000Z',
			step: 'implement',
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheCreationTokens: 0,
			costUsd: 0,
		});
	});

	test('numeric-looking strings are refused rather than coerced', () => {
		for (const extra of [{ outputTokens: '100' }, { costUsd: '0.5' }]) {
			const { line } = setupInvocation({ extra });

			// these are summed into the run total; a string would concatenate
			expect(AgentInvocation.safeParse(line).success).toBe(false);
		}
	});

	test('at, step, model, and effort must be strings, not other types', () => {
		for (const extra of [{ at: 1_767_225_600_000 }, { step: ['implement'] }, { model: 5 }, { effort: 3 }]) {
			const { line } = setupInvocation({ extra });

			expect(AgentInvocation.safeParse(line).success).toBe(false);
		}
	});

	test('keys the contract does not declare are stripped', () => {
		const { line } = setupInvocation({ extra: { sessionId: 'abc', durationMs: 4200 } });

		const parsed = AgentInvocation.parse(line);

		// a driver may log whatever it knows; a reader sees only the declared shape
		expect(parsed).toStrictEqual({
			at: '2026-01-01T00:00:00.000Z',
			step: 'implement',
			inputTokens: 10,
			outputTokens: 100,
			cacheReadTokens: 880,
			cacheCreationTokens: 110,
			costUsd: 0.5,
		});
	});
});
