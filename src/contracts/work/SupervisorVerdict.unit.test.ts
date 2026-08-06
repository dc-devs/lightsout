import { expect, describe, test } from '@jest/globals';
import { SupervisorDecision, SupervisorVerdict } from '@/contracts';

const setupVerdict = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const verdict: Record<string, unknown> = {
		decision: 'retry',
		diagnosis: 'the gate fails because the fixture writes to a path the test never creates',
		...extra,
	};

	if (omit) {
		delete verdict[omit];
	}

	return { verdict };
};

describe('SupervisorVerdict', () => {
	test('a guided retry parses with every field preserved', () => {
		const { verdict } = setupVerdict({ extra: { guidance: 'create the fixture directory before writing to it' } });

		const parsed = SupervisorVerdict.parse(verdict);

		expect(parsed).toStrictEqual({
			decision: 'retry',
			diagnosis: 'the gate fails because the fixture writes to a path the test never creates',
			guidance: 'create the fixture directory before writing to it',
		});
	});

	test('an escalation parses to exactly its two required fields — no guidance is invented', () => {
		const { verdict } = setupVerdict({ extra: { decision: 'escalate' } });

		const parsed = SupervisorVerdict.parse(verdict);

		expect(parsed).toStrictEqual({
			decision: 'escalate',
			diagnosis: 'the gate fails because the fixture writes to a path the test never creates',
		});
	});

	test('decision accepts each of the two routes the supervisor may take', () => {
		for (const decision of ['retry', 'escalate']) {
			const { verdict } = setupVerdict({ extra: { decision } });

			const parsed = SupervisorVerdict.parse(verdict);

			// ${decision} is one of the two outcomes the exception path branches on
			expect(parsed.decision).toBe(decision);
		}
	});

	test('the decision constants carry the wire values the parsed verdict is compared against', () => {
		const { verdict } = setupVerdict({ extra: { decision: 'escalate' } });

		const parsed = SupervisorVerdict.parse(verdict);

		// verifyStep and superviseBatch compare the parsed decision to this constant,
		// so the two spellings must be the same string
		expect(SupervisorDecision.Retry).toBe('retry');
		// the escalate value is what parks the run for a human
		expect(SupervisorDecision.Escalate).toBe('escalate');
		// a parsed verdict matches the constant its call sites branch on
		expect(parsed.decision).toBe(SupervisorDecision.Escalate);
	});

	test('rejects a decision outside the two-route vocabulary', () => {
		const { verdict } = setupVerdict({ extra: { decision: 'abort' } });

		const result = SupervisorVerdict.safeParse(verdict);

		// an invented route is caught at the agent boundary — the pipeline has no
		// third branch to take
		expect(result.success).toBe(false);
	});

	test('rejects the capitalized decision key — the contract carries the lowercase values', () => {
		const { verdict } = setupVerdict({ extra: { decision: 'Retry' } });

		const result = SupervisorVerdict.safeParse(verdict);

		// the enum is built from the SupervisorDecision values, not its capitalized
		// keys
		expect(result.success).toBe(false);
	});

	test('decision and diagnosis are each required', () => {
		for (const field of ['decision', 'diagnosis']) {
			const { verdict } = setupVerdict({ omit: field });

			// a verdict with no ${field} is unusable — decision routes the run and
			// diagnosis is what a parked run is judged from
			expect(SupervisorVerdict.safeParse(verdict).success).toBe(false);
		}
	});

	test('rejects a non-string diagnosis rather than coercing it', () => {
		for (const extra of [{ diagnosis: 7 }, { diagnosis: ['the fixture path is missing'] }]) {
			const { verdict } = setupVerdict({ extra });

			// the diagnosis is printed to a human verbatim
			expect(SupervisorVerdict.safeParse(verdict).success).toBe(false);
		}
	});

	test('rejects a non-string guidance when the field is present', () => {
		const { verdict } = setupVerdict({ extra: { guidance: ['create the fixture directory'] } });

		const result = SupervisorVerdict.safeParse(verdict);

		// guidance is injected into the retry invocation as text, so a list would
		// reach the agent as "[object Object]"
		expect(result.success).toBe(false);
	});

	test('a retry that names no guidance still parses', () => {
		const { verdict } = setupVerdict();

		const parsed = SupervisorVerdict.parse(verdict);

		// the call sites guard on the guidance being present, so a guidance-free retry
		// costs an unguided retry rather than a rejected verdict and a re-emit
		expect(parsed.guidance).toBe(undefined);
	});

	test('an empty diagnosis parses — the contract types the field, it does not grade the analysis', () => {
		const { verdict } = setupVerdict({ extra: { diagnosis: '' } });

		const parsed = SupervisorVerdict.parse(verdict);

		// a thin diagnosis is a prompt problem, not a parse failure that would burn
		// the supervisor budget again
		expect(parsed.diagnosis).toBe('');
	});

	test('keys the schema does not declare are stripped', () => {
		const { verdict } = setupVerdict({ extra: { guidance: 'create the fixture directory', confidence: 0.8, stepId: 'implement' } });

		const parsed = SupervisorVerdict.parse(verdict);

		// the verdict holds the fields the contract declares, whatever else the
		// supervisor volunteered
		expect(parsed).toStrictEqual({
			decision: 'retry',
			diagnosis: 'the gate fails because the fixture writes to a path the test never creates',
			guidance: 'create the fixture directory',
		});
	});
});
