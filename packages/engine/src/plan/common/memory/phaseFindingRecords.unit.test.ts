import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, GapOutcome, type GradeFindingRecord, GradeFindingStatus, type GradeMemory } from '#src/contracts/index.ts';
import { phaseFindingRecords } from '#src/plan/common/memory/phaseFindingRecords.ts';

/**
 * A memory holding two records whose representative phase is the first plan
 * file: a confirmed group whose second observation sits in the second plan file,
 * and a record written before grouping existed — its `observations` is the empty
 * array the schema defaults an old file to — in whichever state a test needs.
 */
const setupMemory = ({ legacyStatus = GradeFindingStatus.Open }: { legacyStatus?: GradeFindingStatus } = {}) => {
	const base = {
		lens: GapCheckLens.Decisions,
		area: GapArea.OmittedDecision,
		options: [],
		firstSeen: '2026-09-01T00:00:00.000Z',
		lastSeen: '2026-09-07T00:00:00.000Z',
		status: GradeFindingStatus.Open,
		disposition: GapOutcome.NeedsAHuman,
		resolutions: [],
		reopened: [],
	};

	const grouped: GradeFindingRecord = {
		...base,
		id: 'f1',
		phase: 'phase1-contracts.md',
		gap: 'the timeout is declared in neither phase consistently',
		decision: 'one home for the timeout',
		sharedDefect: 'the two phases disagree on where the timeout is declared',
		observations: [
			{
				phase: 'phase1-contracts.md',
				lens: GapCheckLens.Surface,
				area: GapArea.UnderspecifiedSurface,
				gap: 'the schema names no timeout field',
				decision: 'whether the timeout lives on the schema',
				options: [],
			},
			{
				phase: 'phase2-runner.md',
				lens: GapCheckLens.Wiring,
				area: GapArea.PhaseSeamMismatch,
				gap: 'the runner reads a timeout the schema never declares',
				decision: 'where the timeout is declared',
				options: [],
			},
		],
	};

	const legacy: GradeFindingRecord = {
		...base,
		id: 'f2',
		phase: 'phase1-contracts.md',
		gap: 'retry count is never decided',
		decision: 'how many times a failed spawn retries',
		observations: [],
		status: legacyStatus,
	};

	const memory: GradeMemory = {
		planName: 'lo-133-duplicate-grading-reports-cause',
		findings: [grouped, legacy],
		nextFindingNumber: 3,
		updatedAt: '2026-09-07T00:00:00.000Z',
	};

	return { memory };
};

describe('phaseFindingRecords', () => {
	test('returns a grouped record for every phase one of its observations sits in', () => {
		const { memory } = setupMemory();

		const byPhase = ['phase1-contracts.md', 'phase2-runner.md'].map((phase) => phaseFindingRecords({ memory, phase }).map((record) => record.id));

		// the grouped record is visible to both plan files it touches, not only the one
		// its representative names, while the legacy record reads as its own phase alone
		expect(byPhase).toStrictEqual([['f1', 'f2'], ['f1']]);
	});

	test('narrows the records touching a phase to the states asked for', () => {
		const { memory } = setupMemory({ legacyStatus: GradeFindingStatus.Pending });

		const pending = phaseFindingRecords({ memory, phase: 'phase1-contracts.md', statuses: [GradeFindingStatus.Pending] });

		// both records touch the first plan file, but only the one in an asked-for
		// state survives the cut
		expect(pending).toEqual([expect.objectContaining({ id: 'f2', status: GradeFindingStatus.Pending })]);
	});
});
