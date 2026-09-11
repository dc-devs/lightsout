import { describe, expect, test } from '@jest/globals';
import {
	GapArea,
	GapCheckLens,
	type GapObservation,
	GapOutcome,
	type GradedGap,
	type GradeFindingRecord,
	GradeFindingStatus,
	type GradeMemory,
} from '#src/contracts/index.ts';
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
	observations: [],
	resolutions: [],
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
	observations: [],
	...overrides,
});

/** One reader's report of a defect at one plan file, as a grouped gap and a record hold it. */
const observationOf = (overrides: Partial<GapObservation> = {}): GapObservation => ({
	area: GapArea.OmittedDecision,
	gap: 'the plan picks no retry limit',
	decision: 'how many times a judge is retried',
	options: [],
	phase: 'phase1-memory.md',
	lens: GapCheckLens.Decisions,
	...overrides,
});

/** One defect as two readers described it: the identity `recordOf` and `gapOf` default to, and its counterpart in phase two. */
const retryLimitSeen = observationOf();
const retryCountSeen = observationOf({
	phase: 'phase2-judge.md',
	lens: GapCheckLens.Wiring,
	area: GapArea.PhaseSeamMismatch,
	gap: 'phase two retries a judge three times',
	decision: 'which retry count the judge follows',
});

/** The statement a judge confirms that group with. */
const sharedDefect = 'the two phases disagree on how often a judge is retried';

/** A ruling that the implementing agent settles the finding, as a gap carries it and as a record keeps it. */
const agentRuling = { outcome: GapOutcome.AgentCanDecide, humanDecision: undefined, agentDecision: 'retry twice', safeBecause: 'the standards settle it' };
const agentNoted = {
	status: GradeFindingStatus.Noted,
	disposition: GapOutcome.AgentCanDecide,
	humanDecision: undefined,
	agentDecision: 'retry twice',
	safeBecause: 'the standards settle it',
};

/** A record no judge has settled yet. */
const pendingState = {
	status: GradeFindingStatus.Pending,
	disposition: undefined,
	humanDecision: undefined,
	unjudgedReason: 'the judge answered without a citation',
};

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

	test('an unjudged finding enters the memory as a pending record with no disposition', () => {
		const unjudged = gapOf({
			outcome: GapOutcome.Unjudged,
			humanDecision: undefined,
			unjudgedReason: 'no judge ran — the fan-out stopped before this finding was judged',
		});

		const { memory, gaps } = setupMerge({ gaps: [unjudged] });

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// nobody weighed it, so there is no disposition to record — and it is kept
		// as pending, which blocks, rather than lost with the grade.json it lived in
		expect(merged.memory).toEqual(
			expect.objectContaining({
				findings: [
					expect.objectContaining({
						id: 'f1',
						status: GradeFindingStatus.Pending,
						disposition: undefined,
						unjudgedReason: 'no judge ran — the fan-out stopped before this finding was judged',
					}),
				],
				nextFindingNumber: 2,
			}),
		);
		expect(merged.gaps).toEqual([{ ...unjudged, findingId: 'f1' }]);
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

	test('opens one record holding every observation of a confirmed group', () => {
		const { memory, gaps } = setupMerge({
			gaps: [
				gapOf({ groupId: 'g1', sharedDefect, observations: [retryLimitSeen, retryCountSeen] }),
				gapOf({ ...retryCountSeen, groupId: 'g1', sharedDefect, observations: [retryLimitSeen, retryCountSeen] }),
			],
		});

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// one confirmed defect is one repair item, however many readers described it
		expect(merged.memory).toEqual(
			expect.objectContaining({
				nextFindingNumber: 2,
				findings: [
					expect.objectContaining({
						id: 'f1',
						status: GradeFindingStatus.Open,
						disposition: GapOutcome.NeedsAHuman,
						sharedDefect,
						observations: [retryLimitSeen, retryCountSeen],
					}),
				],
			}),
		);
		expect(merged.gaps.map((gap) => gap.findingId)).toStrictEqual(['f1', 'f1']);
	});

	test('lets the existing record absorb a group whose members all match it', () => {
		const { memory, gaps } = setupMerge({
			findings: [recordOf({ observations: [retryLimitSeen] })],
			gaps: [
				gapOf({ findingId: 'f1', groupId: 'g1', sharedDefect, observations: [retryLimitSeen, retryCountSeen] }),
				gapOf({ ...retryCountSeen, findingId: 'f1', groupId: 'g1', sharedDefect, observations: [retryLimitSeen, retryCountSeen] }),
			],
		});

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// opening a second record here would fragment the defect again on every pass
		expect(merged.memory).toEqual(
			expect.objectContaining({
				nextFindingNumber: 2,
				findings: [expect.objectContaining({ id: 'f1', firstSeen: seenAt, lastSeen: passAt, observations: [retryLimitSeen, retryCountSeen] })],
			}),
		);
		expect(merged.gaps.map((gap) => gap.findingId)).toStrictEqual(['f1', 'f1']);
	});

	test('supersedes the later record when a group spans two existing records', () => {
		const priorReopen = { at: seenAt, reason: 'the retry count came undone in phase two', priorStatus: GradeFindingStatus.Resolved };
		const { memory, gaps } = setupMerge({
			findings: [
				recordOf({ id: 'f9', observations: [retryLimitSeen] }),
				recordOf({ ...retryCountSeen, id: 'f10', observations: [retryCountSeen], reopened: [priorReopen] }),
			],
			gaps: [
				gapOf({ ...retryCountSeen, findingId: 'f10', groupId: 'g1', sharedDefect, observations: [retryLimitSeen, retryCountSeen] }),
				gapOf({ findingId: 'f9', groupId: 'g1', sharedDefect, observations: [retryLimitSeen, retryCountSeen] }),
			],
		});

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// creation order picks the survivor — numerically, since `f10` sorts before
		// `f9` as a string — and the absorbed record keeps its whole history
		expect(merged.memory.findings).toEqual([
			expect.objectContaining({ id: 'f9', observations: [retryLimitSeen, retryCountSeen] }),
			expect.objectContaining({
				id: 'f10',
				status: GradeFindingStatus.Superseded,
				supersededBy: 'f9',
				firstSeen: seenAt,
				disposition: GapOutcome.NeedsAHuman,
				reopened: [priorReopen],
			}),
		]);
		expect(merged.gaps.map((gap) => gap.findingId)).toStrictEqual(['f9', 'f9']);
	});

	test('raises a closed survivor to open when it absorbs an unanswered obligation', () => {
		const { memory, gaps } = setupMerge({
			findings: [
				recordOf({ ...agentNoted, observations: [retryLimitSeen] }),
				recordOf({ ...retryCountSeen, id: 'f2', humanDecision: 'pick the retry count phase two follows', observations: [retryCountSeen] }),
			],
			gaps: [
				gapOf({ ...agentRuling, findingId: 'f1', groupId: 'g1', sharedDefect, observations: [retryLimitSeen, retryCountSeen] }),
				gapOf({ ...retryCountSeen, ...agentRuling, findingId: 'f2', groupId: 'g1', sharedDefect, observations: [retryLimitSeen, retryCountSeen] }),
			],
		});

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// the earlier record survives, but a question nobody answered cannot be
		// closed by moving it onto a record that happened to be settled
		expect(merged.memory.findings).toEqual([
			expect.objectContaining({
				id: 'f1',
				status: GradeFindingStatus.Open,
				disposition: GapOutcome.AgentCanDecide,
				humanDecision: 'pick the retry count phase two follows',
				resolutions: [],
				reopened: [expect.objectContaining({ at: passAt, priorStatus: GradeFindingStatus.Noted, reason: expect.stringContaining('f2') })],
			}),
			expect.objectContaining({ id: 'f2', status: GradeFindingStatus.Superseded, supersededBy: 'f1' }),
		]);
	});

	test("clears a resolved survivor's citations when it absorbs a pending obligation and leaves an all-closed group closed", () => {
		const timeoutSeen = observationOf({ gap: 'the plan names no default timeout', decision: 'how long a judge may run' });
		const timeoutElsewhere = observationOf({ ...retryCountSeen, gap: 'phase two times a judge out after an hour', decision: 'which timeout applies' });
		const timeoutGroup = { groupId: 'g2', sharedDefect: 'the phases disagree on the timeout', observations: [timeoutSeen, timeoutElsewhere] };
		const { memory, gaps } = setupMerge({
			findings: [
				recordOf({
					status: GradeFindingStatus.Resolved,
					resolutions: [{ phase: 'phase1-memory.md', answerAt: 'a judge is retried twice', verifiedAt: seenAt }],
					observations: [retryLimitSeen],
				}),
				recordOf({ ...retryCountSeen, ...pendingState, id: 'f2', observations: [retryCountSeen] }),
				recordOf({ ...timeoutSeen, ...agentNoted, id: 'f3', observations: [timeoutSeen] }),
				recordOf({ ...timeoutElsewhere, ...agentNoted, id: 'f4', observations: [timeoutElsewhere] }),
			],
			gaps: [
				gapOf({ ...agentRuling, findingId: 'f1', groupId: 'g1', sharedDefect, observations: [retryLimitSeen, retryCountSeen] }),
				gapOf({ ...retryCountSeen, ...agentRuling, findingId: 'f2', groupId: 'g1', sharedDefect, observations: [retryLimitSeen, retryCountSeen] }),
				gapOf({ ...timeoutSeen, ...agentRuling, ...timeoutGroup, findingId: 'f3' }),
				gapOf({ ...timeoutElsewhere, ...agentRuling, ...timeoutGroup, findingId: 'f4' }),
			],
		});

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// the old citation never covered phase two, so the survivor is re-verified
		// everywhere; a group with no unanswered member has nothing to raise
		expect(merged.memory.findings).toEqual([
			expect.objectContaining({ id: 'f1', status: GradeFindingStatus.Open, resolutions: [] }),
			expect.objectContaining({ id: 'f2', status: GradeFindingStatus.Superseded, supersededBy: 'f1' }),
			expect.objectContaining({ id: 'f3', status: GradeFindingStatus.Noted, reopened: [] }),
			expect.objectContaining({ id: 'f4', status: GradeFindingStatus.Superseded, supersededBy: 'f3' }),
		]);
	});

	test('opens one pending record for an unjudged finding and touches it on the next pass', () => {
		const laterAt = '2026-03-01T00:00:00.000Z';
		const unjudged = gapOf({ outcome: GapOutcome.Unjudged, humanDecision: undefined, unjudgedReason: 'the judge answered without a citation' });
		const { memory, gaps } = setupMerge({ gaps: [unjudged] });

		const first = mergeFindingRecords({ memory, gaps, at: passAt });
		const second = mergeFindingRecords({ memory: first.memory, gaps, at: laterAt });

		// nobody weighed it, so it carries no disposition — but it is on record and
		// blocks, and the same unjudged words next pass find that record again
		expect(first.memory.findings).toEqual([
			expect.objectContaining({ id: 'f1', status: GradeFindingStatus.Pending, unjudgedReason: 'the judge answered without a citation', firstSeen: passAt }),
		]);
		expect(first.memory.findings[0]?.disposition).toBeUndefined();
		expect(second.memory).toEqual(
			expect.objectContaining({
				nextFindingNumber: 2,
				findings: [expect.objectContaining({ id: 'f1', status: GradeFindingStatus.Pending, firstSeen: passAt, lastSeen: laterAt })],
			}),
		);
		expect(second.gaps.map((gap) => gap.findingId)).toStrictEqual(['f1']);
	});

	test('promotes a pending record once a judge rules on it', () => {
		const { memory, gaps } = setupMerge({
			findings: [
				recordOf({ ...pendingState, observations: [retryLimitSeen] }),
				recordOf({ ...retryCountSeen, ...pendingState, id: 'f2', observations: [retryCountSeen] }),
			],
			gaps: [gapOf({ findingId: 'f1' }), gapOf({ ...retryCountSeen, ...agentRuling, findingId: 'f2' })],
		});

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// the first real ruling is the disposition the record never had, and it
		// sets the status exactly as it would for a fresh finding
		expect(merged.memory.findings).toEqual([
			expect.objectContaining({ id: 'f1', status: GradeFindingStatus.Open, disposition: GapOutcome.NeedsAHuman }),
			expect.objectContaining({ id: 'f2', status: GradeFindingStatus.Noted, disposition: GapOutcome.AgentCanDecide }),
		]);
		expect(merged.memory.findings.map((record) => record.unjudgedReason)).toStrictEqual([undefined, undefined]);
	});

	test('records the ruling on a pending survivor the group raise moved to open', () => {
		const limitWithOptions = observationOf({ options: ['retry twice', 'retry three times'] });
		const { memory, gaps } = setupMerge({
			findings: [
				recordOf({ ...limitWithOptions, ...pendingState, observations: [limitWithOptions] }),
				recordOf({ ...retryCountSeen, ...pendingState, id: 'f2', observations: [retryCountSeen] }),
			],
			gaps: [
				gapOf({ ...limitWithOptions, ...agentRuling, findingId: 'f1', groupId: 'g1', sharedDefect, observations: [limitWithOptions, retryCountSeen] }),
				gapOf({ ...retryCountSeen, ...agentRuling, findingId: 'f2', groupId: 'g1', sharedDefect, observations: [limitWithOptions, retryCountSeen] }),
			],
		});

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// the ruling is recorded, but the raise decides the status: an absorbed
		// unanswered obligation keeps blocking, with its own question to read
		expect(merged.memory.findings).toEqual([
			expect.objectContaining({
				id: 'f1',
				status: GradeFindingStatus.Open,
				disposition: GapOutcome.AgentCanDecide,
				gap: 'the plan picks no retry limit',
				decision: 'how many times a judge is retried',
				options: ['retry twice', 'retry three times'],
			}),
			expect.objectContaining({ id: 'f2', status: GradeFindingStatus.Superseded, supersededBy: 'f1' }),
		]);
		expect(merged.memory.findings[0]?.unjudgedReason).toBeUndefined();
	});

	test('reopens a resolved record that gains an observation at an unverified location', () => {
		const { memory, gaps } = setupMerge({
			findings: [
				recordOf({
					status: GradeFindingStatus.Resolved,
					resolutions: [{ phase: 'phase1-memory.md', answerAt: 'a judge is retried twice', verifiedAt: seenAt }],
					observations: [retryLimitSeen],
				}),
			],
			gaps: [gapOf({ ...retryCountSeen, ...agentRuling, findingId: 'f1', observations: [retryCountSeen] })],
		});

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// a closure is a claim about the plan files it cited — phase two is one
		// nobody verified, so even a ruling that blocks nothing cannot inherit it
		expect(merged.memory.findings).toEqual([
			expect.objectContaining({
				id: 'f1',
				status: GradeFindingStatus.Open,
				resolutions: [],
				reopened: [expect.objectContaining({ at: passAt, priorStatus: GradeFindingStatus.Resolved, reason: expect.stringContaining('phase2-judge.md') })],
			}),
		]);
	});

	test('synthesises an observation for a gap that carries none when it touches a record', () => {
		const importSeen = observationOf({
			phase: 'phase2-judge.md',
			lens: GapCheckLens.Wiring,
			area: GapArea.UnwiredDependency,
			gap: 'phase two never imports the retry limit',
			decision: 'where phase two reads the retry limit from',
			options: ['the constants module', 'the judge config'],
		});
		const { memory, gaps } = setupMerge({
			findings: [recordOf({ observations: [retryLimitSeen] })],
			gaps: [gapOf({ ...importSeen, findingId: 'f1', observations: [] })],
		});

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// an ordinary single ruling carries no observations, yet it still tells the
		// record it now appears in phase two, where it must be re-verified
		expect(merged.memory.findings).toEqual([expect.objectContaining({ id: 'f1', observations: [retryLimitSeen, importSeen] })]);
	});

	test('redirects a gap naming a record superseded earlier in the same fold', () => {
		const reportSeen = observationOf({
			phase: 'phase3-report.md',
			lens: GapCheckLens.Surface,
			area: GapArea.UnderspecifiedSurface,
			gap: 'the report never says which retry count it prints',
			decision: 'which retry count the report prints',
		});
		const { memory, gaps } = setupMerge({
			findings: [
				recordOf({ ...pendingState, id: 'f9', observations: [retryLimitSeen] }),
				recordOf({ ...retryCountSeen, ...pendingState, id: 'f10', observations: [retryCountSeen] }),
			],
			gaps: [
				gapOf({ findingId: 'f9', groupId: 'g1', sharedDefect, observations: [retryLimitSeen, retryCountSeen] }),
				gapOf({ ...retryCountSeen, findingId: 'f10', groupId: 'g1', sharedDefect, observations: [retryLimitSeen, retryCountSeen] }),
				gapOf({ ...reportSeen, findingId: 'f10', humanDecision: 'say which retry count the report prints', observations: [] }),
			],
		});

		const merged = mergeFindingRecords({ memory, gaps, at: passAt });

		// the third judge named `f10` before this fold absorbed it; its finding
		// follows the obligation to `f9` rather than landing where nothing checks
		expect(merged.memory.findings).toEqual([
			expect.objectContaining({ id: 'f9', status: GradeFindingStatus.Open, observations: [retryLimitSeen, retryCountSeen, reportSeen] }),
			expect.objectContaining({ id: 'f10', status: GradeFindingStatus.Superseded, supersededBy: 'f9' }),
		]);
		expect(merged.gaps.map((gap) => gap.findingId)).toStrictEqual(['f9', 'f9', 'f9']);
	});
});
