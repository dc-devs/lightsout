import { describe, expect, test } from '@jest/globals';
import { GradeMemory } from '#src/contracts/plan/memory/GradeMemory.ts';

const setupMemory = (overrides: Record<string, unknown> = {}) => {
	const inputs = {
		planFiles: [
			{ file: 'overview.md', sha256: 'a'.repeat(64) },
			{ file: 'phase1-preflight.md', sha256: 'b'.repeat(64) },
		],
		gradedCommit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
		changedFiles: [{ path: 'packages/engine/src/plan/runPlanGrade.ts', sha256: 'c'.repeat(64) }],
		standards: 'd'.repeat(64),
		config: 'e'.repeat(64),
		prompts: 'f'.repeat(64),
		model: 'claude-opus-5',
		effort: 'high',
		sha256: '0'.repeat(64),
	};
	const record = {
		id: 'f1',
		phase: 'phase1-preflight.md',
		lens: 'decisions',
		area: 'omitted-decision',
		gap: 'the plan never says what happens when the memory file is malformed',
		decision: 'say whether a malformed memory fails the pass or starts a new baseline',
		options: ['fail the pass', 'treat it as missing'],
		firstSeen: '2026-09-01T00:00:00.000Z',
		lastSeen: '2026-09-02T00:00:00.000Z',
		status: 'resolved',
		disposition: 'needs-a-human',
		humanDecision: 'choose the malformed-memory behaviour',
		resolution: {
			answerAt: 'Decision Log row 27: a malformed memory fails the pass naming the file',
			verifiedAt: '2026-09-02T00:00:00.000Z',
		},
		reopened: [{ at: '2026-09-01T12:00:00.000Z', reason: 'the cited row was deleted', priorStatus: 'resolved' }],
	};
	const memory = {
		planName: 'grade-scope-and-finding-memory',
		findings: [record],
		lastPass: { scope: 'focused', inputs, at: '2026-09-02T00:00:00.000Z' },
		lastPassingFullReview: { inputs, at: '2026-09-01T00:00:00.000Z' },
		nextFindingNumber: 2,
		updatedAt: '2026-09-02T00:00:00.000Z',
		...overrides,
	};

	return { memory, record, inputs };
};

/** The same memory with one fingerprint on BOTH of its recorded passes, so a test reads each field back twice over. */
const setupMemoryFingerprinted = ({ extra }: { extra: Record<string, unknown> }) => {
	const inputs = { ...setupMemory().inputs, ...extra };

	return setupMemory({
		lastPass: { scope: 'focused', inputs, at: '2026-09-02T00:00:00.000Z' },
		lastPassingFullReview: { inputs, at: '2026-09-01T00:00:00.000Z' },
	});
};

/** The decision rows the decision-log cases measure, shared by the fixture and the expectation it is read back against. */
const decisionLogPart = {
	overviewDesign: '1'.repeat(64),
	rows: [
		{ sha256: '2'.repeat(64), questionSha256: '3'.repeat(64) },
		{
			sha256: '4'.repeat(64),
			questionSha256: '5'.repeat(64),
			phases: ['phase1-preflight.md', 'phase2-extra.md'],
		},
	],
};

/** The two plan files a pass recorded before design hashes existed carries — a whole-file digest and nothing else. */
const unhashedPlanFiles = [
	{ file: 'overview.md', sha256: 'a'.repeat(64) },
	{ file: 'phase1-preflight.md', sha256: 'b'.repeat(64) },
];

/** The two plan files a design-hash case measures, each carrying the digest of the text a reader read. */
const designHashedPlanFiles = [
	{ file: 'overview.md', sha256: 'a'.repeat(64), designSha256: '6'.repeat(64) },
	{ file: 'phase1-preflight.md', sha256: 'b'.repeat(64), designSha256: '7'.repeat(64) },
];

const setupDecisionLogMemory = () => setupMemoryFingerprinted({ extra: { decisionLog: decisionLogPart } });

const setupDesignHashMemory = () =>
	setupMemoryFingerprinted({
		extra: {
			planFiles: designHashedPlanFiles,
			decisionLog: {
				overviewDesign: '8'.repeat(64),
				rows: [{ sha256: '2'.repeat(64), questionSha256: '3'.repeat(64) }],
			},
		},
	});

const setupPreDesignHashMemory = () =>
	setupMemoryFingerprinted({
		extra: {
			decisionLog: {
				overview: '1'.repeat(64),
				rows: [{ sha256: '2'.repeat(64), questionSha256: '3'.repeat(64) }],
			},
		},
	});

const setupCoverageMemory = () =>
	setupMemory({
		coverage: {
			readers: [
				{
					file: 'phase1-preflight.md',
					lens: 'decisions',
					designSha256: '9'.repeat(64),
					neighbours: ['overview.md', 'phase2-extra.md'],
					at: '2026-09-02T00:00:00.000Z',
				},
				{
					file: 'phase2-extra.md',
					lens: 'wiring',
					designSha256: 'c'.repeat(64),
					neighbours: [],
					at: '2026-09-02T00:00:00.000Z',
				},
			],
			docs: {
				planFiles: [
					{ file: 'overview.md', designSha256: 'd'.repeat(64) },
					{ file: 'phase1-preflight.md', designSha256: '9'.repeat(64) },
				],
				at: '2026-09-02T00:00:00.000Z',
			},
		},
	});

const setupRecheckedFindings = () => {
	const { record } = setupMemory();
	const stamped = {
		...record,
		id: 'f2',
		status: 'open',
		lastRecheckedAt: '2026-09-03T00:00:00.000Z',
	};

	return setupMemory({ findings: [record, stamped], nextFindingNumber: 3 });
};

describe('GradeMemory', () => {
	test('a written memory round-trips through GradeMemory', () => {
		const { memory } = setupMemory();

		const parsed = GradeMemory.parse(memory);

		// the next pass reads its whole scope decision back out of this file, so
		// every field a pass wrote has to survive the round trip unchanged
		expect(parsed).toStrictEqual({
			planName: 'grade-scope-and-finding-memory',
			findings: [
				{
					id: 'f1',
					phase: 'phase1-preflight.md',
					lens: 'decisions',
					area: 'omitted-decision',
					gap: 'the plan never says what happens when the memory file is malformed',
					decision: 'say whether a malformed memory fails the pass or starts a new baseline',
					options: ['fail the pass', 'treat it as missing'],
					firstSeen: '2026-09-01T00:00:00.000Z',
					lastSeen: '2026-09-02T00:00:00.000Z',
					status: 'resolved',
					disposition: 'needs-a-human',
					humanDecision: 'choose the malformed-memory behaviour',
					resolution: {
						answerAt: 'Decision Log row 27: a malformed memory fails the pass naming the file',
						verifiedAt: '2026-09-02T00:00:00.000Z',
					},
					// a record written before grouping existed holds no observation list
					// and no per-location resolutions of its own; readers fall back to
					// its representative fields and its single resolution
					observations: [],
					resolutions: [],
					reopened: [{ at: '2026-09-01T12:00:00.000Z', reason: 'the cited row was deleted', priorStatus: 'resolved' }],
				},
			],
			lastPass: {
				scope: 'focused',
				at: '2026-09-02T00:00:00.000Z',
				inputs: {
					planFiles: [
						{ file: 'overview.md', sha256: 'a'.repeat(64) },
						{ file: 'phase1-preflight.md', sha256: 'b'.repeat(64) },
					],
					gradedCommit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
					changedFiles: [{ path: 'packages/engine/src/plan/runPlanGrade.ts', sha256: 'c'.repeat(64) }],
					standards: 'd'.repeat(64),
					config: 'e'.repeat(64),
					prompts: 'f'.repeat(64),
					model: 'claude-opus-5',
					effort: 'high',
					sha256: '0'.repeat(64),
				},
			},
			lastPassingFullReview: {
				at: '2026-09-01T00:00:00.000Z',
				inputs: {
					planFiles: [
						{ file: 'overview.md', sha256: 'a'.repeat(64) },
						{ file: 'phase1-preflight.md', sha256: 'b'.repeat(64) },
					],
					gradedCommit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
					changedFiles: [{ path: 'packages/engine/src/plan/runPlanGrade.ts', sha256: 'c'.repeat(64) }],
					standards: 'd'.repeat(64),
					config: 'e'.repeat(64),
					prompts: 'f'.repeat(64),
					model: 'claude-opus-5',
					effort: 'high',
					sha256: '0'.repeat(64),
				},
			},
			// no pass has recorded a reading yet, so the contract fills the field
			// rather than leaving it absent
			coverage: { readers: [] },
			nextFindingNumber: 2,
			updatedAt: '2026-09-02T00:00:00.000Z',
		});
	});

	test("an older memory file parses with the contract's defaults", () => {
		const parsed = GradeMemory.parse({
			planName: 'grade-scope-and-finding-memory',
			updatedAt: '2026-09-02T00:00:00.000Z',
		});

		// a memory written before a pass ever recorded its fingerprint has no
		// baseline to offer, and an absent one must never read as a match: the
		// record set is empty, the id counter starts at one, and neither pass
		// stamp is invented
		expect(parsed).toStrictEqual({
			planName: 'grade-scope-and-finding-memory',
			findings: [],
			coverage: { readers: [] },
			nextFindingNumber: 1,
			updatedAt: '2026-09-02T00:00:00.000Z',
		});
	});

	test('a pass recorded with a decision-log part round-trips through GradeMemory', () => {
		const { memory } = setupDecisionLogMemory();

		const parsed = GradeMemory.parse(memory);

		// the scope comparison reads the earlier pass's decision rows back out of
		// this file, so a dropped part or a dropped row's phases would silently
		// widen or narrow the next review
		expect({
			lastPass: parsed.lastPass?.inputs.decisionLog,
			lastPassingFullReview: parsed.lastPassingFullReview?.inputs.decisionLog,
		}).toStrictEqual({ lastPass: decisionLogPart, lastPassingFullReview: decisionLogPart });
	});

	test('a pass recorded before the decision-log part existed parses with the part absent', () => {
		const { memory } = setupMemory();

		const parsed = GradeMemory.parse(memory);

		// an earlier pass with no decision evidence must stay without it: an empty
		// part filled in here would compare as "no decision changed"
		expect({
			lastPass: parsed.lastPass?.inputs.sha256,
			lastPassDecisionLog: parsed.lastPass?.inputs.decisionLog,
			lastPassingFullReview: parsed.lastPassingFullReview?.inputs.sha256,
			lastPassingFullReviewDecisionLog: parsed.lastPassingFullReview?.inputs.decisionLog,
		}).toStrictEqual({
			lastPass: '0'.repeat(64),
			lastPassDecisionLog: undefined,
			lastPassingFullReview: '0'.repeat(64),
			lastPassingFullReviewDecisionLog: undefined,
		});
	});

	test('a pass recorded with design hashes round-trips through GradeMemory', () => {
		const { memory } = setupDesignHashMemory();

		const parsed = GradeMemory.parse(memory);

		// the next pass decides how far it reaches from the text a reader actually
		// read, so a dropped per-file design hash or a dropped shared overview hash
		// would make a recorded reading unreadable
		expect({
			lastPassPlanFiles: parsed.lastPass?.inputs.planFiles,
			lastPassOverviewDesign: parsed.lastPass?.inputs.decisionLog?.overviewDesign,
			fullReviewPlanFiles: parsed.lastPassingFullReview?.inputs.planFiles,
			fullReviewOverviewDesign: parsed.lastPassingFullReview?.inputs.decisionLog?.overviewDesign,
		}).toStrictEqual({
			lastPassPlanFiles: designHashedPlanFiles,
			lastPassOverviewDesign: '8'.repeat(64),
			fullReviewPlanFiles: designHashedPlanFiles,
			fullReviewOverviewDesign: '8'.repeat(64),
		});
	});

	test('a memory recorded before design hashes parses with them absent', () => {
		const { memory } = setupPreDesignHashMemory();

		const parsed = GradeMemory.parse(memory);

		// nobody measured the design text of that earlier pass, and an absent
		// measurement must never read as a match: no plan file is handed a digest,
		// and the old whole-overview field is not mistaken for the shared design
		// hash, so the plan takes exactly one full re-baseline
		expect({
			lastPassPlanFiles: parsed.lastPass?.inputs.planFiles,
			lastPassOverviewDesign: parsed.lastPass?.inputs.decisionLog?.overviewDesign,
			lastPassRows: parsed.lastPass?.inputs.decisionLog?.rows,
			fullReviewPlanFiles: parsed.lastPassingFullReview?.inputs.planFiles,
			fullReviewOverviewDesign: parsed.lastPassingFullReview?.inputs.decisionLog?.overviewDesign,
		}).toStrictEqual({
			lastPassPlanFiles: unhashedPlanFiles,
			lastPassOverviewDesign: undefined,
			lastPassRows: [{ sha256: '2'.repeat(64), questionSha256: '3'.repeat(64) }],
			fullReviewPlanFiles: unhashedPlanFiles,
			fullReviewOverviewDesign: undefined,
		});
	});

	test('a memory carrying read coverage round-trips through GradeMemory', () => {
		const { memory } = setupCoverageMemory();

		const parsed = GradeMemory.parse(memory);

		// the next pass decides what it may skip from these entries alone, so a
		// dropped file, lens, design hash, neighbour list or stamp would either
		// re-buy a reading already paid for or reuse one that no longer stands
		expect(parsed.coverage).toStrictEqual({
			readers: [
				{
					file: 'phase1-preflight.md',
					lens: 'decisions',
					designSha256: '9'.repeat(64),
					neighbours: ['overview.md', 'phase2-extra.md'],
					at: '2026-09-02T00:00:00.000Z',
				},
				{
					file: 'phase2-extra.md',
					lens: 'wiring',
					designSha256: 'c'.repeat(64),
					neighbours: [],
					at: '2026-09-02T00:00:00.000Z',
				},
			],
			docs: {
				planFiles: [
					{ file: 'overview.md', designSha256: 'd'.repeat(64) },
					{ file: 'phase1-preflight.md', designSha256: '9'.repeat(64) },
				],
				at: '2026-09-02T00:00:00.000Z',
			},
		});
	});

	test('a memory written before coverage existed parses with no coverage claimed', () => {
		const { memory } = setupMemory();

		const parsed = GradeMemory.parse(memory);

		// nobody recorded a reading on that plan, and an absent record must claim
		// none rather than be rejected or handed an invented documentation entry:
		// the plan takes exactly one full re-baseline
		expect(parsed.coverage).toStrictEqual({ readers: [] });
	});

	test('a recheck stamp round-trips, and a record written before it stays unstamped', () => {
		const { memory } = setupRecheckedFindings();

		const parsed = GradeMemory.parse(memory);

		// the narrowed re-verification asks about every record no judge has ever
		// answered, so a stamp lost on the way to disk buys a judge that was already
		// paid for, and a stamp invented on a record written before the field
		// silences that record forever
		expect(parsed.findings.map(({ id, lastRecheckedAt }) => ({ id, lastRecheckedAt }))).toStrictEqual([
			{ id: 'f1', lastRecheckedAt: undefined },
			{ id: 'f2', lastRecheckedAt: '2026-09-03T00:00:00.000Z' },
		]);
	});
});
