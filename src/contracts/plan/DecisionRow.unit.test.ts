import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DecisionRow } from '@/contracts';

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

		assert.deepEqual(parsed, {
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

		assert.equal(parsed.assumption, false, 'a row without the flag is a human-confirmed choice — the gap-check only surfaces the flagged ones');
	});

	test('an explicit assumption row keeps the flag the gap-check reads', () => {
		const { row } = setupRow({ assumption: true });

		const parsed = DecisionRow.parse(row);

		assert.equal(parsed.assumption, true, 'a choice made without human confirmation stays marked through the parse');
	});

	test('source accepts each stage of the planning dialogue', () => {
		for (const source of ['Elicitation', 'Grill', 'Dedup', 'Converge']) {
			const { row } = setupRow({ source });

			const parsed = DecisionRow.parse(row);

			assert.equal(parsed.source, source, `${source} is one of the stages a Decision-Log row can come from`);
		}
	});

	test('rejects a lowercase source — the capitalized token is the one decisions.json and the markdown column share', () => {
		const { row } = setupRow({ source: 'elicitation' });

		const result = DecisionRow.safeParse(row);

		assert.equal(result.success, false, 'the enum carries the capitalized values on purpose, so the JSON field and the Decision-Log Source column stay one token');
	});

	test('rejects a source outside the planning dialogue stages', () => {
		const { row } = setupRow({ source: 'Review' });

		const result = DecisionRow.safeParse(row);

		assert.equal(result.success, false, 'an invented stage is caught at the contract, before a plan is drafted from it');
	});

	test('rejects a row missing any required field', () => {
		for (const field of ['source', 'question', 'options', 'choice', 'rationale']) {
			const { row } = setupRow({ [field]: undefined });

			const result = DecisionRow.safeParse(row);

			assert.equal(result.success, false, `${field} is required — a half-authored row would draft a plan whose Decision Log has a hole in it`);
		}
	});

	test('rejects a non-string field rather than stringifying it', () => {
		for (const field of ['question', 'options', 'choice', 'rationale']) {
			const { row } = setupRow({ [field]: 42 });

			const result = DecisionRow.safeParse(row);

			assert.equal(result.success, false, `${field} is prose the human reads in the Decision Log, not a number`);
		}
	});

	test('rejects a non-boolean assumption rather than coercing truthiness', () => {
		const { row } = setupRow({ assumption: 'true' });

		const result = DecisionRow.safeParse(row);

		assert.equal(result.success, false, 'the gap-check branches on the flag directly, so a truthy string must never reach it');
	});

	test('strips keys the contract does not declare', () => {
		const { row } = setupRow({ number: 7, supersededBy: 15 });

		const parsed = DecisionRow.parse(row);

		assert.deepEqual(
			Object.keys(parsed).sort(),
			['assumption', 'choice', 'options', 'question', 'rationale', 'source'],
			'a row carries the six declared fields, whatever else the session happened to write beside them',
		);
	});
});
