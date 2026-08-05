import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DecisionsRecord } from '@/contracts';

/** One authored Decision-Log row, as the session writes it into decisions.json. */
const decisionRow = {
	source: 'Elicitation',
	question: 'where do plan deliverables live?',
	options: 'repo root / .claude/plans',
	choice: '.claude/plans',
	rationale: 'the committed, human-reviewed path implement reads',
	assumption: false,
};

/** The session-authored `decisions.json` record `plan draft` reads. */
const setupRecord = (overrides: Record<string, unknown> = {}) => {
	const record = {
		planName: 'grill-me',
		decisions: [decisionRow],
		...overrides,
	};

	return { record };
};

describe('DecisionsRecord', () => {
	test('a full record parses with the plan name and its rows preserved', () => {
		const { record } = setupRecord({
			decisions: [decisionRow, { ...decisionRow, source: 'Grill', choice: 'repo root', assumption: true }],
		});

		const parsed = DecisionsRecord.parse(record);

		assert.deepEqual(parsed, {
			planName: 'grill-me',
			decisions: [
				{
					source: 'Elicitation',
					question: 'where do plan deliverables live?',
					options: 'repo root / .claude/plans',
					choice: '.claude/plans',
					rationale: 'the committed, human-reviewed path implement reads',
					assumption: false,
				},
				{
					source: 'Grill',
					question: 'where do plan deliverables live?',
					options: 'repo root / .claude/plans',
					choice: 'repo root',
					rationale: 'the committed, human-reviewed path implement reads',
					assumption: true,
				},
			],
		});
	});

	test('decisions defaults to empty when the session has authored no rows yet', () => {
		const { record } = setupRecord({ decisions: undefined });

		const parsed = DecisionsRecord.parse(record);

		assert.deepEqual(parsed.decisions, [], 'a record with no rows yet is authored, not corrupt — the default keeps every downstream join array-safe');
	});

	test('a row omitting assumption gets the false default through the record', () => {
		const { record } = setupRecord({
			decisions: [
				{
					source: 'Elicitation',
					question: 'where do plan deliverables live?',
					options: 'repo root / .claude/plans',
					choice: '.claude/plans',
					rationale: 'the committed, human-reviewed path implement reads',
				},
			],
		});

		const parsed = DecisionsRecord.parse(record);

		assert.equal(parsed.decisions[0]?.assumption, false, 'the row contract applies inside the record, so plan draft always reads a boolean flag');
	});

	test('rejects a record missing its plan name', () => {
		const { record } = setupRecord({ planName: undefined });

		const result = DecisionsRecord.safeParse(record);

		assert.equal(result.success, false, 'planName keys the plan workspace the draft is written into');
	});

	test('rejects a non-string plan name', () => {
		const { record } = setupRecord({ planName: 42 });

		const result = DecisionsRecord.safeParse(record);

		assert.equal(result.success, false, 'the name is the kebab workspace key, not a number');
	});

	test('rejects decisions that is a bare row rather than a list of rows', () => {
		const { record } = setupRecord({ decisions: decisionRow });

		const result = DecisionsRecord.safeParse(record);

		assert.equal(result.success, false, 'a single object is a malformed record, not a one-entry log');
	});

	test('rejects a record whose row violates the row contract', () => {
		for (const decisions of [[{ ...decisionRow, source: 'Review' }], [{ source: 'Elicitation', question: 'q' }], ['a decision']]) {
			const { record } = setupRecord({ decisions });

			const result = DecisionsRecord.safeParse(record);

			assert.equal(result.success, false, 'a malformed row fails the whole record — drafting from decisions that were never authored would silently produce a bad plan');
		}
	});

	test('strips keys the contract does not declare', () => {
		const { record } = setupRecord({ authoredAt: '2026-07-09T00:00:00.000Z' });

		const parsed = DecisionsRecord.parse(record);

		assert.deepEqual(Object.keys(parsed).sort(), ['decisions', 'planName'], 'decisions.json holds the two fields the contract declares, whatever else the session wrote beside them');
	});
});
