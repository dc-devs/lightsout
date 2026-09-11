import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, type GapObservation, GapOutcome, type GradeFindingRecord, GradeFindingStatus } from '#src/contracts/index.ts';
import { absorbObservations } from '#src/plan/common/memory/absorbObservations.ts';

/** When an earlier pass wrote the record, and when the pass under test runs. */
const seenAt = '2026-01-01T00:00:00.000Z';
const passAt = '2026-02-01T00:00:00.000Z';

/** One reader's report of the defect at one plan file — by default the identity the record itself was opened with. */
const observationOf = (overrides: Partial<GapObservation> = {}): GapObservation => ({
	phase: 'phase1-contracts.md',
	lens: GapCheckLens.Decisions,
	area: GapArea.OmittedDecision,
	gap: 'the plan picks no retry limit',
	decision: 'how many times a judge is retried',
	options: ['once', 'twice'],
	...overrides,
});

/** The same defect as a second reader described it in phase two. */
const phaseTwoSeen = observationOf({
	phase: 'phase2-runner.md',
	lens: GapCheckLens.Wiring,
	area: GapArea.PhaseSeamMismatch,
	gap: 'phase two retries a judge three times',
	decision: 'which retry count the runner follows',
	options: [],
});

/** The same defect as a third reader described it in phase three. */
const phaseThreeSeen = observationOf({
	phase: 'phase3-report.md',
	lens: GapCheckLens.Surface,
	gap: 'the report never prints the retry count',
	options: [],
});

/**
 * A record an earlier pass left behind — written before grouping existed unless
 * a case gives it observations — and the observations joining it this pass.
 */
const setupAbsorb = ({ record = {}, joining }: { record?: Partial<GradeFindingRecord>; joining: GapObservation[] }) => {
	const stored: GradeFindingRecord = {
		id: 'f1',
		...observationOf(),
		firstSeen: seenAt,
		lastSeen: seenAt,
		status: GradeFindingStatus.Open,
		disposition: GapOutcome.NeedsAHuman,
		humanDecision: 'pick the retry limit',
		observations: [],
		resolutions: [],
		reopened: [],
		...record,
	};

	return { record: stored, observations: joining };
};

describe('absorbObservations', () => {
	test("keeps a legacy record's own location when the first observation joins it", () => {
		const { record, observations } = setupAbsorb({ joining: [phaseTwoSeen] });

		const absorbed = absorbObservations({ record, observations, at: passAt });

		// an empty list on a record written before grouping means its own identity,
		// never nothing — reading it as nothing would lose phase one to phase two
		expect(absorbed).toStrictEqual({ ...record, observations: [observationOf(), phaseTwoSeen] });
	});

	test('holds an observation the record already carries only once', () => {
		const retyped = observationOf({ gap: '  The plan picks NO retry   limit ' });
		const { record, observations } = setupAbsorb({ record: { observations: [observationOf()] }, joining: [retyped, phaseTwoSeen] });

		const absorbed = absorbObservations({ record, observations, at: passAt });

		// whitespace and case move freely between two re-typings of one line
		expect(absorbed.observations).toStrictEqual([observationOf(), phaseTwoSeen]);
	});

	test('reopens a resolved record for every location its citations do not cover', () => {
		const { record, observations } = setupAbsorb({
			record: {
				status: GradeFindingStatus.Resolved,
				observations: [observationOf()],
				resolutions: [{ phase: 'phase1-contracts.md', answerAt: 'A judge is retried twice.', verifiedAt: seenAt }],
			},
			joining: [phaseTwoSeen, phaseThreeSeen],
		});

		const absorbed = absorbObservations({ record, observations, at: passAt });

		// a closure is a claim about the files it cited; two files nobody verified
		// cannot inherit it, and the reason names both of them
		expect(absorbed).toEqual(
			expect.objectContaining({
				status: GradeFindingStatus.Open,
				resolutions: [],
				resolution: undefined,
				lastSeen: passAt,
				observations: [observationOf(), phaseTwoSeen, phaseThreeSeen],
				reopened: [
					{
						at: passAt,
						priorStatus: GradeFindingStatus.Resolved,
						reason: expect.stringMatching(/phase2-runner\.md.*phase3-report\.md/),
					},
				],
			}),
		);
	});

	test('leaves a resolved record closed when every location it gains is already cited', () => {
		const sameFileRewording = observationOf({ lens: GapCheckLens.Wiring, gap: 'phase one never caps how often a judge reruns' });
		const legacyResolution = { answerAt: 'A judge is retried twice.', verifiedAt: seenAt };
		const { record, observations } = setupAbsorb({
			record: { status: GradeFindingStatus.Resolved, resolution: legacyResolution },
			joining: [sameFileRewording],
		});

		const absorbed = absorbObservations({ record, observations, at: passAt });

		// the closure written before per-location citations existed still covers the
		// record's own plan file, so a second wording there changes nothing about it
		expect(absorbed).toStrictEqual({ ...record, observations: [observationOf(), sameFileRewording] });
	});

	test('leaves a noted record noted when it gains an uncited location', () => {
		const { record, observations } = setupAbsorb({
			record: { status: GradeFindingStatus.Noted, disposition: GapOutcome.AgentCanDecide, humanDecision: undefined, agentDecision: 'retry twice' },
			joining: [phaseTwoSeen],
		});

		const absorbed = absorbObservations({ record, observations, at: passAt });

		// a noted record never held a verified citation, so there is no closure a
		// new location could wrongly inherit
		expect(absorbed).toStrictEqual({ ...record, observations: [observationOf(), phaseTwoSeen] });
	});
});
