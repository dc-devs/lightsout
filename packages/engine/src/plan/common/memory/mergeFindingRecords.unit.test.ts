import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, GapOutcome, type GradedGap, type GradeFindingRecord, GradeFindingStatus, type GradeMemory } from '#src/contracts/index.ts';
import { mergeFindingRecords } from '#src/plan/common/memory/mergeFindingRecords.ts';

/** When an earlier pass saw a finding, and when the pass under test runs. */
const seenAt = '2026-01-01T00:00:00.000Z';
const passAt = '2026-02-01T00:00:00.000Z';

/** One record as an earlier pass left it: a question a human was asked to settle. */
const recordOf = (overrides: Partial<GradeFindingRecord> = {}): GradeFindingRecord => ({
	id: 'f1',
	phase: 'phase1-memory.md',
	lens: GapCheckLens.Decisions,
	area: GapArea.OmittedDecision,
	gap: 'the plan picks no retry limit',
	decision: 'how many times a judge is retried',
	options: [],
	firstSeen: seenAt,
	lastSeen: seenAt,
	status: GradeFindingStatus.Open,
	disposition: GapOutcome.NeedsAHuman,
	humanDecision: 'pick the retry limit',
	reopened: [],
	...overrides,
});

/** One gap of this pass, labelled and ruled on the way the fold receives it. */
const gapOf = (overrides: Partial<GradedGap> = {}): GradedGap => ({
	area: GapArea.OmittedDecision,
	gap: 'the plan picks no retry limit',
	decision: 'how many times a judge is retried',
	options: [],
	phase: 'phase1-memory.md',
	lens: GapCheckLens.Decisions,
	outcome: GapOutcome.NeedsAHuman,
	humanDecision: 'pick the retry limit',
	...overrides,
});

/** The memory a pass found, and the gaps it folds into it. */
const setupMerge = ({ findings = [], gaps = [] }: { findings?: GradeFindingRecord[]; gaps?: GradedGap[] } = {}) => {
	const memory: GradeMemory = {
		planName: 'lo-126-grade-memory',
		findings,
		nextFindingNumber: findings.length + 1,
		updatedAt: seenAt,
	};

	return { memory, gaps };
};

describe('mergeFindingRecords', () => {
	test('every judged outcome enters the memory with the status its disposition implies', () => {
		const { memory, gaps } = setupMerge({
			gaps: [
				gapOf(),
				gapOf({
					gap: 'the plan names no default timeout',
					outcome: GapOutcome.AgentCanDecide,
					humanDecision: undefined,
					agentDecision: 'retry twice',
					safeBecause: 'the standards settle it',
				}),
				gapOf({
					gap: 'the plan never says which file holds the floor',
					outcome: GapOutcome.AlreadyAnswered,
					humanDecision: undefined,
					answerAt: 'Decision Log row 4',
				}),
			],
		});

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// a human's question stays open; a question a judge settled is kept only so
		// the next pass does not re-investigate it, and blocks nothing
		expect(merged.memory).toEqual(
			expect.objectContaining({
				nextFindingNumber: 4,
				findings: [
					expect.objectContaining({
						id: 'f1',
						status: GradeFindingStatus.Open,
						disposition: GapOutcome.NeedsAHuman,
						humanDecision: 'pick the retry limit',
						firstSeen: passAt,
						lastSeen: passAt,
					}),
					expect.objectContaining({
						id: 'f2',
						status: GradeFindingStatus.Noted,
						disposition: GapOutcome.AgentCanDecide,
						agentDecision: 'retry twice',
						safeBecause: 'the standards settle it',
					}),
					expect.objectContaining({
						id: 'f3',
						status: GradeFindingStatus.Noted,
						disposition: GapOutcome.AlreadyAnswered,
						answerAt: 'Decision Log row 4',
					}),
				],
			}),
		);
		expect(merged.gaps.map((gap) => gap.findingId)).toStrictEqual(['f1', 'f2', 'f3']);
	});

	test('an unjudged finding is left out of the memory', () => {
		const unjudged = gapOf({
			outcome: GapOutcome.Unjudged,
			humanDecision: undefined,
			unjudgedReason: 'no judge ran — the fan-out stopped before this finding was judged',
		});

		const { memory, gaps } = setupMerge({ gaps: [unjudged] });

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// nobody weighed it, so there is no disposition to record — and a record
		// carrying none would let the next pass read it as settled
		expect(merged.memory).toEqual(expect.objectContaining({ findings: [], nextFindingNumber: 1 }));
		expect(merged.gaps).toEqual([unjudged]);
		expect(merged.gaps[0]?.findingId).toBe(undefined);
	});

	test('contrary evidence reopens a resolved record and records why', () => {
		const { memory, gaps } = setupMerge({
			findings: [
				recordOf({
					status: GradeFindingStatus.Resolved,
					resolution: { answerAt: 'a judge is retried twice', verifiedAt: seenAt },
				}),
			],
			gaps: [gapOf({ findingId: 'f1', humanDecision: 'the retry limit is still unspecified' })],
		});

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// the one path that corrects a wrong clearance — and it writes down what it
		// undid, so the reopening is auditable rather than silent
		expect(merged.memory.findings).toEqual([
			expect.objectContaining({
				id: 'f1',
				status: GradeFindingStatus.Open,
				resolution: undefined,
				lastSeen: passAt,
				reopened: [{ at: passAt, reason: 'the retry limit is still unspecified', priorStatus: GradeFindingStatus.Resolved }],
			}),
		]);
	});

	test('a re-reported settled finding stays settled', () => {
		const { memory, gaps } = setupMerge({
			findings: [
				recordOf({
					id: 'f1',
					status: GradeFindingStatus.Noted,
					disposition: GapOutcome.AlreadyAnswered,
					humanDecision: undefined,
					answerAt: 'Decision Log row 4',
				}),
				recordOf({
					id: 'f2',
					gap: 'the plan names no default timeout',
					status: GradeFindingStatus.Noted,
					disposition: GapOutcome.AgentCanDecide,
					humanDecision: undefined,
					agentDecision: 'retry twice',
					safeBecause: 'the standards settle it',
				}),
				recordOf({
					id: 'f3',
					gap: 'the plan never says which file holds the floor',
					status: GradeFindingStatus.Resolved,
					resolution: { answerAt: 'a judge is retried twice', verifiedAt: seenAt },
				}),
			],
			gaps: [
				gapOf({
					findingId: 'f1',
					outcome: GapOutcome.AlreadyAnswered,
					humanDecision: undefined,
					answerAt: 'Decision Log row 4',
				}),
				gapOf({
					findingId: 'f2',
					gap: 'the plan names no default timeout',
					outcome: GapOutcome.AgentCanDecide,
					humanDecision: undefined,
					agentDecision: 'retry twice',
					safeBecause: 'the standards settle it',
				}),
				gapOf({
					findingId: 'f3',
					gap: 'the plan never says which file holds the floor',
					outcome: GapOutcome.AlreadyAnswered,
					humanDecision: undefined,
					answerAt: 'Decision Log row 4',
				}),
			],
		});

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// only a needs-a-human ruling may undo a closure, so each record is touched
		// once — to say it was seen again this pass — and no duplicate is opened
		expect(merged.memory).toEqual(
			expect.objectContaining({
				nextFindingNumber: 4,
				findings: [
					expect.objectContaining({ id: 'f1', status: GradeFindingStatus.Noted, lastSeen: passAt, reopened: [] }),
					expect.objectContaining({ id: 'f2', status: GradeFindingStatus.Noted, lastSeen: passAt, reopened: [] }),
					expect.objectContaining({
						id: 'f3',
						status: GradeFindingStatus.Resolved,
						resolution: { answerAt: 'a judge is retried twice', verifiedAt: seenAt },
						lastSeen: passAt,
						reopened: [],
					}),
				],
			}),
		);
	});

	test('an open record cannot be downgraded to an agent decision', () => {
		const { memory, gaps } = setupMerge({
			findings: [recordOf()],
			gaps: [
				gapOf({
					findingId: 'f1',
					outcome: GapOutcome.AgentCanDecide,
					humanDecision: undefined,
					agentDecision: 'retry twice',
					safeBecause: 'the standards settle it',
				}),
			],
		});

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// a human's question is answered in the plan, never downgraded to an
		// assumption by a later judge
		expect(merged.memory.findings).toEqual([
			expect.objectContaining({
				id: 'f1',
				status: GradeFindingStatus.Open,
				disposition: GapOutcome.NeedsAHuman,
				humanDecision: 'pick the retry limit',
				agentDecision: undefined,
				safeBecause: undefined,
				lastSeen: passAt,
			}),
		]);
	});

	test('a documentation finding matches its record by phase, area and gap text', () => {
		const { memory, gaps } = setupMerge({
			findings: [
				recordOf({
					phase: 'overview.md',
					lens: undefined,
					area: GapArea.MissingDocumentation,
					gap: 'The docs list omits README.md',
					humanDecision: 'say what README.md must state',
				}),
			],
			gaps: [
				gapOf({
					phase: 'overview.md',
					lens: undefined,
					area: GapArea.MissingDocumentation,
					gap: 'the docs   list omits README.md',
					humanDecision: 'say what README.md must state',
				}),
			],
		});

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// the documentation checker never meets the judge, so no verdict can name
		// the record for it — without the deterministic match it would open a
		// duplicate every pass
		expect(merged.memory).toEqual(
			expect.objectContaining({
				nextFindingNumber: 2,
				findings: [expect.objectContaining({ id: 'f1', firstSeen: seenAt, lastSeen: passAt })],
			}),
		);
		expect(merged.gaps.map((gap) => gap.findingId)).toStrictEqual(['f1']);
	});
});
