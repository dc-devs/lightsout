import { expect, describe, test } from '@jest/globals';
import { BrainstormDecisions } from '@/contracts';

/** One brainstorm-settled Decision-Log row, as `/brainstorm` writes it into brainstorm-decisions.json. */
const decisionRow = {
	source: 'Brainstorm',
	question: 'where do plan deliverables live?',
	options: 'repo root / .claude/plans',
	choice: '.claude/plans',
	rationale: 'the committed, human-reviewed path implement reads',
	assumption: false,
};

/** The brainstorm-authored `brainstorm-decisions.json` record `plan draft` reads when it exists. */
const setupRecord = (overrides: Record<string, unknown> = {}) => {
	const record = {
		planName: 'grill-me',
		decisions: [decisionRow],
		...overrides,
	};

	return { record };
};

describe('BrainstormDecisions', () => {
	test('a full record parses with the plan name and its rows preserved', () => {
		const { record } = setupRecord({
			decisions: [decisionRow, { ...decisionRow, choice: 'repo root', assumption: true }],
		});

		const parsed = BrainstormDecisions.parse(record);

		expect(parsed).toStrictEqual({
			planName: 'grill-me',
			decisions: [
				{
					source: 'Brainstorm',
					question: 'where do plan deliverables live?',
					options: 'repo root / .claude/plans',
					choice: '.claude/plans',
					rationale: 'the committed, human-reviewed path implement reads',
					assumption: false,
				},
				{
					source: 'Brainstorm',
					question: 'where do plan deliverables live?',
					options: 'repo root / .claude/plans',
					choice: 'repo root',
					rationale: 'the committed, human-reviewed path implement reads',
					assumption: true,
				},
			],
		});
	});

	test('decisions defaults to empty when the key is absent', () => {
		const { record } = setupRecord({ decisions: undefined });

		const parsed = BrainstormDecisions.parse(record);

		// a brainstorm that settled nothing still hands off a readable record
		expect(parsed.decisions).toStrictEqual([]);
	});

	test('a row omitting assumption gets the false default through the record', () => {
		const { record } = setupRecord({
			decisions: [
				{
					source: 'Brainstorm',
					question: 'where do plan deliverables live?',
					options: 'repo root / .claude/plans',
					choice: '.claude/plans',
					rationale: 'the committed, human-reviewed path implement reads',
				},
			],
		});

		const parsed = BrainstormDecisions.parse(record);

		// the row contract applies inside the record, so plan draft always reads a
		// boolean flag
		expect(parsed.decisions[0]?.assumption).toBe(false);
	});

	test('rejects any row whose source is a plan-dialogue origin — only Brainstorm parses', () => {
		for (const source of ['Elicitation', 'Grill', 'Dedup', 'Converge']) {
			const { record } = setupRecord({ decisions: [{ ...decisionRow, source }] });

			const result = BrainstormDecisions.safeParse(record);

			// ${source} belongs in decisions.json — a mislabelled row is a hard read
			// failure, never a silent relabel in the Decision Log
			expect(result.success).toBe(false);
		}
	});

	test('rejects a record missing its plan name', () => {
		const { record } = setupRecord({ planName: undefined });

		const result = BrainstormDecisions.safeParse(record);

		// planName keys the plan workspace the rows are merged into
		expect(result.success).toBe(false);
	});

	test('rejects a non-string plan name', () => {
		const { record } = setupRecord({ planName: 42 });

		const result = BrainstormDecisions.safeParse(record);

		// the name is the kebab workspace key, not a number
		expect(result.success).toBe(false);
	});

	test('rejects decisions that is a bare row rather than a list of rows', () => {
		const { record } = setupRecord({ decisions: decisionRow });

		const result = BrainstormDecisions.safeParse(record);

		// a single object is a malformed record, not a one-entry log
		expect(result.success).toBe(false);
	});

	test('strips keys the contract does not declare', () => {
		const { record } = setupRecord({ authoredAt: '2026-07-09T00:00:00.000Z' });

		const parsed = BrainstormDecisions.parse(record);

		// brainstorm-decisions.json holds the two fields the contract declares,
		// whatever else the skill wrote beside them
		expect(Object.keys(parsed).sort()).toStrictEqual(['decisions', 'planName']);
	});
});
