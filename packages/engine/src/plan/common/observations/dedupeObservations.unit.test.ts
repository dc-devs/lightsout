import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, type GapObservation } from '#src/contracts/index.ts';
import { dedupeObservations } from '#src/plan/common/observations/dedupeObservations.ts';

/** One reader's observation, varying only the fields the de-duplication key reads. */
const observationOf = (overrides: Partial<GapObservation> = {}): GapObservation => ({
	phase: 'phase-1-reader.md',
	lens: GapCheckLens.Decisions,
	area: GapArea.OmittedDecision,
	gap: 'the plan picks no failure mode',
	decision: 'what to return when the judge times out',
	options: [],
	...overrides,
});

describe('dedupeObservations', () => {
	test('drops a re-typing of an earlier observation and keeps the first in place', () => {
		const first = observationOf();
		const other = observationOf({ phase: 'phase-2-writer.md', gap: 'the writer never says what a timed-out judge leaves behind' });
		// the same line re-typed by a second member: wrapped, re-cased, and with a
		// decision and options the key never reads
		const retyped = observationOf({ gap: '  The plan picks\nno FAILURE mode ', decision: 'pick the failure mode', options: ['block', 'retry'] });

		const deduped = dedupeObservations({ observations: [first, other, retyped] });

		expect(deduped).toStrictEqual([first, other]);
	});

	test.each<{ field: string; overrides: Partial<GapObservation> }>([
		{ field: 'plan file', overrides: { phase: 'phase-2-writer.md' } },
		{ field: 'lens', overrides: { lens: GapCheckLens.Wiring } },
		{ field: 'missing lens', overrides: { lens: undefined } },
		{ field: 'area', overrides: { area: GapArea.PhaseSeamMismatch } },
		{ field: 'gap wording', overrides: { gap: 'the plan picks no retry budget' } },
	])('keeps two observations that differ only in $field', ({ overrides }) => {
		const first = observationOf();
		const second = observationOf(overrides);

		const deduped = dedupeObservations({ observations: [first, second] });

		// the same words at another location, under another lens or another area are
		// a second place the defect was seen, never a repeat of the first
		expect(deduped).toStrictEqual([first, second]);
	});
});
