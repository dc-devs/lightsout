import { describe, expect, test } from '@jest/globals';
import { DecisionRow } from '#src/contracts/index.ts';

/** One Decision-Log row as the session authors it during the planning dialogue. */
const setupRow = (overrides: Record<string, unknown> = {}) => {
	const row = {
		source: 'Elicitation',
		question: 'where do plan deliverables live?',
		options: 'repo root / .claude/plans',
		choice: '.claude/plans',
		rationale: 'the committed, human-reviewed path implement reads',
		...overrides,
	};

	return { row };
};

describe('DecisionRow', () => {
	test('a full row parses with every authored field preserved', () => {
		const { row } = setupRow({ source: 'Grill', assumption: true });

		const parsed = DecisionRow.parse(row);

		expect(parsed).toStrictEqual({
			source: 'Grill',
			question: 'where do plan deliverables live?',
			options: 'repo root / .claude/plans',
			choice: '.claude/plans',
			rationale: 'the committed, human-reviewed path implement reads',
			assumption: true,
		});
	});

	test('assumption defaults to false when the session omits it', () => {
		const { row } = setupRow();

		const parsed = DecisionRow.parse(row);

		// a row without the flag is a human-confirmed choice — the gap-check only
		// surfaces the flagged ones
		expect(parsed.assumption).toBe(false);
	});

	test('an explicit assumption row keeps the flag the gap-check reads', () => {
		const { row } = setupRow({ assumption: true });

		const parsed = DecisionRow.parse(row);

		// a choice made without human confirmation stays marked through the parse
		expect(parsed.assumption).toBe(true);
	});

	test('source accepts each stage of the planning dialogue', () => {
		for (const source of ['Brainstorm', 'Elicitation', 'Grill', 'Dedup', 'Converge']) {
			const { row } = setupRow({ source });

			const parsed = DecisionRow.parse(row);

			// ${source} is one of the stages a Decision-Log row can come from
			expect(parsed.source).toBe(source);
		}
	});

	test('rejects a lowercase source — the capitalized token is the one decisions.json and the markdown column share', () => {
		const { row } = setupRow({ source: 'elicitation' });

		const result = DecisionRow.safeParse(row);

		// the enum carries the capitalized values on purpose, so the JSON field and
		// the Decision-Log Source column stay one token
		expect(result.success).toBe(false);
	});

	test('rejects a source outside the planning dialogue stages', () => {
		const { row } = setupRow({ source: 'Review' });

		const result = DecisionRow.safeParse(row);

		// an invented stage is caught at the contract, before a plan is drafted from
		// it
		expect(result.success).toBe(false);
	});

	test('rejects a row missing any required field', () => {
		for (const field of ['source', 'question', 'options', 'choice', 'rationale']) {
			const { row } = setupRow({ [field]: undefined });

			const result = DecisionRow.safeParse(row);

			// ${field} is required — a half-authored row would draft a plan whose Decision
			// Log has a hole in it
			expect(result.success).toBe(false);
		}
	});

	test('rejects a non-string field rather than stringifying it', () => {
		for (const field of ['question', 'options', 'choice', 'rationale']) {
			const { row } = setupRow({ [field]: 42 });

			const result = DecisionRow.safeParse(row);

			// ${field} is prose the human reads in the Decision Log, not a number
			expect(result.success).toBe(false);
		}
	});

	test('rejects a non-boolean assumption rather than coercing truthiness', () => {
		const { row } = setupRow({ assumption: 'true' });

		const result = DecisionRow.safeParse(row);

		// the gap-check branches on the flag directly, so a truthy string must never
		// reach it
		expect(result.success).toBe(false);
	});

	test('strips keys the contract does not declare', () => {
		const { row } = setupRow({ number: 7, supersededBy: 15 });

		const parsed = DecisionRow.parse(row);

		// a row carries the six declared fields, whatever else the session happened to
		// write beside them
		expect(Object.keys(parsed).sort()).toStrictEqual(['assumption', 'choice', 'options', 'question', 'rationale', 'source']);
	});

	test('a row declaring phases keeps them in the order written', () => {
		const { row } = setupRow({ phases: ['phase3-final.md', 'phase2-extra.md'] });

		const parsed = DecisionRow.parse(row);

		// the declared phase files survive the parse as a declared key, in the order
		// the session wrote them
		expect(parsed.phases).toStrictEqual(['phase3-final.md', 'phase2-extra.md']);
	});

	test('rejects an empty phases list rather than reading it as the whole plan', () => {
		const { row } = setupRow({ phases: [] });

		const result = DecisionRow.safeParse(row);

		// an empty list could read as a decision reaching no phase; absence is the one
		// way to say the whole plan
		expect(result.success).toBe(false);
	});

	test('a row without phases parses with the field absent', () => {
		const { row } = setupRow();

		const parsed = DecisionRow.parse(row);

		// no empty list is filled in — a missing list means the whole plan, or a reach
		// not yet established
		expect(Object.hasOwn(parsed, 'phases')).toBe(false);
	});
});
