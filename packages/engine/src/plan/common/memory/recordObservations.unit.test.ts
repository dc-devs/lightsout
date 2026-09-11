import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, type GapObservation, GapOutcome, type GradeFindingRecord, GradeFindingStatus } from '#src/contracts/index.ts';
import { recordObservations } from '#src/plan/common/memory/recordObservations.ts';

/**
 * Two records side by side: one written before grouping existed — its
 * `observations` is the empty array the schema defaults an old file to — and one
 * a confirmed group opened holding two observations whose wording differs from
 * the record's own representative fields, so a reader that synthesised instead of
 * returning what is stored would be caught.
 */
const setupRecords = () => {
	const base = {
		firstSeen: '2026-09-01T00:00:00.000Z',
		lastSeen: '2026-09-07T00:00:00.000Z',
		status: GradeFindingStatus.Open,
		disposition: GapOutcome.NeedsAHuman,
		resolutions: [],
		reopened: [],
	};

	const legacy: GradeFindingRecord = {
		...base,
		id: 'f1',
		phase: 'phase1-contracts.md',
		lens: GapCheckLens.Decisions,
		area: GapArea.OmittedDecision,
		gap: 'retry count is never decided',
		decision: 'how many times a failed spawn retries',
		options: ['once', 'never'],
		observations: [],
	};

	const storedObservations: GapObservation[] = [
		{
			phase: 'phase1-contracts.md',
			lens: GapCheckLens.Surface,
			area: GapArea.UnderspecifiedSurface,
			gap: 'the schema names no timeout field',
			decision: 'whether the timeout lives on the schema',
			options: ['add it', 'leave it out'],
		},
		{
			phase: 'phase2-runner.md',
			lens: GapCheckLens.Wiring,
			area: GapArea.PhaseSeamMismatch,
			gap: 'the runner reads a timeout the schema never declares',
			decision: 'where the timeout is declared',
			options: [],
		},
	];

	const grouped: GradeFindingRecord = {
		...base,
		id: 'f2',
		phase: 'phase1-contracts.md',
		lens: GapCheckLens.Surface,
		area: GapArea.UnderspecifiedSurface,
		gap: 'the timeout is declared in neither phase consistently',
		decision: 'one home for the timeout',
		options: ['schema', 'runner'],
		sharedDefect: 'the two phases disagree on where the timeout is declared',
		observations: storedObservations,
	};

	return { legacy, grouped, storedObservations };
};

describe('recordObservations', () => {
	test('synthesises one observation for a record written before grouping existed', () => {
		const { legacy, grouped, storedObservations } = setupRecords();

		const read = [legacy, grouped].map((record) => recordObservations({ record }));

		// no group is ever inferred from an old record's text: it reads as exactly one
		// observation built from its own identity, while a grouped record's stored
		// observations come back as they were written
		expect(read).toStrictEqual([
			[
				{
					phase: 'phase1-contracts.md',
					lens: GapCheckLens.Decisions,
					area: GapArea.OmittedDecision,
					gap: 'retry count is never decided',
					decision: 'how many times a failed spawn retries',
					options: ['once', 'never'],
				},
			],
			storedObservations,
		]);
	});
});
