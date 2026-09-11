import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, type GapObservation, GapOutcome, type GradedGap } from '#src/contracts/index.ts';
import { groupGapCandidates } from '#src/plan/common/grading/groupGapCandidates.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { GapBatch } from '#src/plan/common/types/GapBatch.ts';

const planDir = '/plans/demo';

const firstPhase = 'phase-1-reader.md';
const secondPhase = 'phase-2-judge.md';
const thirdPhase = 'phase-3-memory.md';
const fourthPhase = 'phase-4-report.md';
const fifthPhase = 'phase-5-render.md';

/** The text each plan file holds — distinct per file, so a batch carrying the wrong file's text is told apart. */
const planTextOf = (phase: string) => `# ${phase}\n\nThe body of ${phase}.\n`;

/** One reader finding as the fold hands it to the batching stage. The default decision holds only short words, so no two findings are related by their decision alone. */
const gapOf = (overrides: Partial<GradedGap> = {}): GradedGap => ({
	area: GapArea.OmittedDecision,
	gap: 'the plan is vague',
	decision: 'pick one',
	options: [],
	phase: firstPhase,
	lens: GapCheckLens.Decisions,
	outcome: GapOutcome.Unjudged,
	observations: [],
	...overrides,
});

/** One reader's report at one plan file, as a carried grouped record holds several of. */
const observationOf = ({ phase, gap }: { phase: string; gap: string }): GapObservation => ({
	area: GapArea.PhaseSeamMismatch,
	gap,
	decision: 'pick one',
	options: [],
	phase,
	lens: GapCheckLens.Wiring,
});

/** Every plan file the deliverable holds, with its text, plus the findings this pass will judge. */
const setupBatching = ({ phases, gaps }: { phases: string[]; gaps: Array<Partial<GradedGap>> }) => {
	const files: DeliverableFile[] = phases.map((phase) => ({ path: join(planDir, phase), text: planTextOf(phase) }));

	return { files, gaps: gaps.map((overrides) => gapOf(overrides)) };
};

/** A batch list reduced to what each batch holds, free of the ids and positions an input order assigns — so two orders of one input compare. */
const shapeOf = (batches: GapBatch[]) =>
	batches
		.map(({ observations, planTexts }) => ({
			gaps: observations.map(({ gap }) => gap.gap).sort(),
			phases: planTexts.map(({ phase }) => phase).sort(),
		}))
		.sort((a, b) => (a.gaps[0] ?? '').localeCompare(b.gaps[0] ?? ''));

describe('groupGapCandidates', () => {
	test('batches two findings across phases that share two distinctive words', () => {
		const { files, gaps } = setupBatching({
			phases: [firstPhase, secondPhase],
			gaps: [
				{ phase: firstPhase, gap: 'the rollback of a failed migration is never described', decision: 'describe the rollback' },
				{
					phase: secondPhase,
					lens: GapCheckLens.Wiring,
					area: GapArea.PhaseSeamMismatch,
					gap: 'this file assumes the migration rollback already ran',
					decision: 'order the two steps',
				},
			],
		});

		const batches = groupGapCandidates({ gaps, files });

		// a different area and a different plan file do not keep one contradiction
		// apart — the judge that settles it has to read both files at once
		expect(batches).toStrictEqual([
			{
				observations: [
					{ id: 'o1', index: 0, gap: gaps[0] },
					{ id: 'o2', index: 1, gap: gaps[1] },
				],
				planTexts: [
					{ phase: firstPhase, text: planTextOf(firstPhase) },
					{ phase: secondPhase, text: planTextOf(secondPhase) },
				],
			},
		]);
	});

	test('leaves findings with no shared distinctive words as batches of one', () => {
		const { files, gaps } = setupBatching({
			phases: [firstPhase, secondPhase],
			gaps: [
				{ phase: firstPhase, gap: 'the cache eviction policy is unstated', decision: 'choose an eviction policy for this phase' },
				{ phase: secondPhase, gap: 'the webhook payload never states its eviction window', decision: 'name the payload window for this phase' },
			],
		});

		const batches = groupGapCandidates({ gaps, files });

		// one shared long word, plus the short words every finding carries, is not
		// enough to spend a combined prompt on
		expect({ count: batches.length, batches }).toEqual({
			count: 2,
			batches: expect.arrayContaining([
				{ observations: [{ id: 'o1', index: 0, gap: gaps[0] }], planTexts: [{ phase: firstPhase, text: planTextOf(firstPhase) }] },
				{ observations: [{ id: 'o2', index: 1, gap: gaps[1] }], planTexts: [{ phase: secondPhase, text: planTextOf(secondPhase) }] },
			]),
		});
	});

	test('splits an oversized group so every batch honours both caps and covers every finding once', () => {
		const phases = [firstPhase, secondPhase, thirdPhase, fourthPhase, fifthPhase];
		const findingPhases = [firstPhase, firstPhase, firstPhase, firstPhase, firstPhase, firstPhase, secondPhase, thirdPhase, fourthPhase, fifthPhase];
		const { files, gaps } = setupBatching({
			phases,
			gaps: findingPhases.map((phase, position) => ({ phase, gap: `case ${position}: the idempotency keystore is never rotated` })),
		});

		const batches = groupGapCandidates({ gaps, files });

		// every finding shares the same two long words, so all ten are one candidate
		// group — no single prompt may hold it, and the split must lose nothing
		expect({
			overCap: batches.filter(({ observations, planTexts }) => observations.length > 8 || planTexts.length > 3),
			mismatchedTexts: batches.filter(
				({ observations, planTexts }) =>
					[...new Set(observations.map(({ gap }) => gap.phase))].sort().join() !==
					planTexts
						.map(({ phase }) => phase)
						.sort()
						.join(),
			),
			misplaced: batches.flatMap(({ observations }) => observations.filter(({ id, index, gap }) => id !== `o${index + 1}` || gap !== gaps[index])),
			indexes: batches.flatMap(({ observations }) => observations.map(({ index }) => index)).sort((a, b) => a - b),
		}).toStrictEqual({ overCap: [], mismatchedTexts: [], misplaced: [], indexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
	});

	test('omits a finding whose phase names no plan file and batches deterministically', () => {
		const { files, gaps } = setupBatching({
			phases: [firstPhase, secondPhase, thirdPhase],
			gaps: [
				{ phase: firstPhase, gap: 'the rollback of a failed migration is never described' },
				{ phase: 'phase-9-renamed.md', gap: 'the archival scheduler cadence is vague' },
				{ phase: secondPhase, gap: 'this file assumes the migration rollback already ran' },
				{ phase: thirdPhase, gap: 'the telemetry exporter format drifts' },
			],
		});

		const batches = groupGapCandidates({ gaps, files });
		const reordered = groupGapCandidates({ gaps: [...gaps].reverse(), files });

		// a finding with no plan text to judge it against reaches the join unjudged,
		// which blocks; and a grade that batched differently on another order of the
		// same findings could not be compared across passes
		const expected = [
			{
				gaps: ['the rollback of a failed migration is never described', 'this file assumes the migration rollback already ran'],
				phases: [firstPhase, secondPhase],
			},
			{ gaps: ['the telemetry exporter format drifts'], phases: [thirdPhase] },
		];

		expect({ original: shapeOf(batches), reordered: shapeOf(reordered) }).toStrictEqual({ original: expected, reordered: expected });
	});

	test('batches a finding for a plan file no reader read this pass', () => {
		// the third file was weighed light, so no reader was offered it — but the
		// batching stage is handed every plan file the deliverable holds
		const { files, gaps } = setupBatching({
			phases: [firstPhase, secondPhase, thirdPhase],
			gaps: [
				{
					phase: thirdPhase,
					gap: 'the checkpoint cadence is unstated',
					findingId: 'f4',
					unjudgedReason: 'the judge was rate limited or overloaded',
				},
			],
		});

		const batches = groupGapCandidates({ gaps, files });

		expect(batches).toStrictEqual([{ observations: [{ id: 'o1', index: 0, gap: gaps[0] }], planTexts: [{ phase: thirdPhase, text: planTextOf(thirdPhase) }] }]);
	});

	test("builds planTexts from a carried gap's whole observation list, not its phase", () => {
		const { files, gaps } = setupBatching({
			phases: [firstPhase, secondPhase, thirdPhase, fourthPhase],
			gaps: [
				{
					phase: firstPhase,
					gap: 'the rollback of a failed migration is never described',
					findingId: 'f3',
					observations: [
						observationOf({ phase: firstPhase, gap: 'the rollback of a failed migration is never described' }),
						observationOf({ phase: secondPhase, gap: 'this file assumes the migration rollback already ran' }),
					],
				},
				{ phase: thirdPhase, gap: 'the migration rollback has no owner' },
				{ phase: fourthPhase, gap: 'nobody reruns the rollback after a migration' },
			],
		});

		const batches = groupGapCandidates({ gaps, files });

		const carriedBatch = batches.find(({ observations }) => observations.some(({ index }) => index === 0));
		// counted by phase the three findings span three files and fit one batch;
		// counted by location they span four, so they cannot — and the carried gap's
		// batch must hold the second file's text its ruling will be asked to cite
		expect({
			carriedTexts: carriedBatch?.planTexts,
			overCap: batches.filter(({ planTexts }) => planTexts.length > 3),
			indexes: batches.flatMap(({ observations }) => observations.map(({ index }) => index)).sort((a, b) => a - b),
		}).toEqual({
			carriedTexts: expect.arrayContaining([
				{ phase: firstPhase, text: planTextOf(firstPhase) },
				{ phase: secondPhase, text: planTextOf(secondPhase) },
			]),
			overCap: [],
			indexes: [0, 1, 2],
		});
	});

	test('emits a lone over-cap finding as one batch instead of dropping it', () => {
		const { files, gaps } = setupBatching({
			phases: [firstPhase, secondPhase, thirdPhase, fourthPhase, fifthPhase],
			gaps: [
				{
					phase: firstPhase,
					gap: 'the tenancy boundary contradicts itself',
					findingId: 'f2',
					observations: [firstPhase, secondPhase, thirdPhase, fourthPhase].map((phase) =>
						observationOf({ phase, gap: 'the tenancy boundary contradicts itself' }),
					),
				},
			],
		});

		const batches = groupGapCandidates({ gaps, files });

		// one observation has no seam to split on, and dropping it would leave it
		// unjudgeable — the cap binds only the combining of two or more findings
		expect(batches).toStrictEqual([
			{
				observations: [{ id: 'o1', index: 0, gap: gaps[0] }],
				planTexts: [
					{ phase: firstPhase, text: planTextOf(firstPhase) },
					{ phase: secondPhase, text: planTextOf(secondPhase) },
					{ phase: thirdPhase, text: planTextOf(thirdPhase) },
					{ phase: fourthPhase, text: planTextOf(fourthPhase) },
				],
			},
		]);
	});

	test('drops a stale location but keeps the gap, and omits a gap with no live location', () => {
		const { files, gaps } = setupBatching({
			phases: [firstPhase, secondPhase],
			gaps: [
				{
					phase: firstPhase,
					gap: 'the quota ceiling is unstated',
					findingId: 'f5',
					observations: [
						observationOf({ phase: firstPhase, gap: 'the quota ceiling is unstated' }),
						observationOf({ phase: 'phase-7-renamed.md', gap: 'the quota ceiling is unstated' }),
					],
				},
				{
					phase: 'phase-8-gone.md',
					gap: 'the archival scheduler cadence is vague',
					findingId: 'f6',
					observations: [
						observationOf({ phase: 'phase-8-gone.md', gap: 'the archival scheduler cadence is vague' }),
						observationOf({ phase: 'phase-9-gone.md', gap: 'the archival scheduler cadence is vague' }),
					],
				},
			],
		});

		const batches = groupGapCandidates({ gaps, files });

		// a location a resplit renamed away has no text to cite against, so it is
		// dropped — while the gap stays judgeable at the location that still exists
		expect(batches).toStrictEqual([{ observations: [{ id: 'o1', index: 0, gap: gaps[0] }], planTexts: [{ phase: firstPhase, text: planTextOf(firstPhase) }] }]);
	});
});
