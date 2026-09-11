import { describe, expect, test } from '@jest/globals';
import { GradeMemory } from '#src/contracts/index.ts';

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

const setupDecisionLogMemory = () => {
	const { inputs } = setupMemory();
	const withDecisionLog = {
		...inputs,
		decisionLog: {
			overview: '1'.repeat(64),
			rows: [
				{ sha256: '2'.repeat(64), questionSha256: '3'.repeat(64) },
				{
					sha256: '4'.repeat(64),
					questionSha256: '5'.repeat(64),
					phases: ['phase1-preflight.md', 'phase2-extra.md'],
				},
			],
		},
	};

	return setupMemory({
		lastPass: { scope: 'focused', inputs: withDecisionLog, at: '2026-09-02T00:00:00.000Z' },
		lastPassingFullReview: { inputs: withDecisionLog, at: '2026-09-01T00:00:00.000Z' },
	});
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
		}).toStrictEqual({
			lastPass: {
				overview: '1'.repeat(64),
				rows: [
					{ sha256: '2'.repeat(64), questionSha256: '3'.repeat(64) },
					{
						sha256: '4'.repeat(64),
						questionSha256: '5'.repeat(64),
						phases: ['phase1-preflight.md', 'phase2-extra.md'],
					},
				],
			},
			lastPassingFullReview: {
				overview: '1'.repeat(64),
				rows: [
					{ sha256: '2'.repeat(64), questionSha256: '3'.repeat(64) },
					{
						sha256: '4'.repeat(64),
						questionSha256: '5'.repeat(64),
						phases: ['phase1-preflight.md', 'phase2-extra.md'],
					},
				],
			},
		});
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
});
