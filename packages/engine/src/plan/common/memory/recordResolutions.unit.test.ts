import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, GapOutcome, type GradeFindingRecord, GradeFindingStatus } from '#src/contracts/index.ts';
import { recordResolutions } from '#src/plan/common/memory/recordResolutions.ts';

const resolvedAt = '2026-09-08T00:00:00.000Z';

/** One `resolved` record at `phase1-contracts.md`, varying only how its closure was stored. */
const setupRecord = ({ resolution, resolutions = [] }: { resolution?: GradeFindingRecord['resolution']; resolutions?: GradeFindingRecord['resolutions'] }) => {
	const record: GradeFindingRecord = {
		id: 'f1',
		phase: 'phase1-contracts.md',
		lens: GapCheckLens.Decisions,
		area: GapArea.OmittedDecision,
		gap: 'which retry budget applies',
		decision: 'pick the retry budget',
		options: [],
		observations: [],
		firstSeen: '2026-09-01T00:00:00.000Z',
		lastSeen: '2026-09-07T00:00:00.000Z',
		status: GradeFindingStatus.Resolved,
		disposition: GapOutcome.NeedsAHuman,
		resolution,
		resolutions,
		reopened: [],
	};

	return { record };
};

/** A record closed before per-location resolutions existed, beside one closed after, whose legacy field is stale. */
const setupLegacyAndCurrentRecords = () => {
	const { record: legacy } = setupRecord({
		resolution: { answerAt: 'The retry budget is three attempts.', verifiedAt: resolvedAt },
	});
	const { record: current } = setupRecord({
		resolution: { answerAt: 'A stale legacy citation.', verifiedAt: resolvedAt },
		resolutions: [
			{ phase: 'phase1-contracts.md', answerAt: 'The retry budget is three attempts.', verifiedAt: resolvedAt },
			{ phase: 'phase2-engine.md', answerAt: 'Retries stop after three attempts.', verifiedAt: resolvedAt },
		],
	});

	return { records: [legacy, current] };
};

describe('recordResolutions', () => {
	test("reads a legacy single resolution as one entry at the record's own phase", () => {
		const { records } = setupLegacyAndCurrentRecords();

		const read = records.map((record) => recordResolutions({ record }));

		expect(read).toStrictEqual([
			// the legacy closure still has one citation to re-validate, at the record's own plan file
			[{ phase: 'phase1-contracts.md', answerAt: 'The retry budget is three attempts.', verifiedAt: resolvedAt }],
			// once per-location resolutions are stored, the stale legacy field adds nothing
			[
				{ phase: 'phase1-contracts.md', answerAt: 'The retry budget is three attempts.', verifiedAt: resolvedAt },
				{ phase: 'phase2-engine.md', answerAt: 'Retries stop after three attempts.', verifiedAt: resolvedAt },
			],
		]);
	});

	test('reads a record holding no closure in either field as no resolutions', () => {
		const { record } = setupRecord({});

		const read = recordResolutions({ record });

		// nothing is invented at the record's own phase when nothing was ever cited
		expect(read).toStrictEqual([]);
	});
});
