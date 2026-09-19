import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type DecisionRow, DecisionSource, type GradeInputs } from '#src/contracts/index.ts';
import { getGradeInputs } from '#src/plan/common/scope/getGradeInputs.ts';
import { getPlanDesignHash } from '#src/plan/common/scope/getPlanDesignHash.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';
import { overviewWithLog, overviewWithTwoLogs, phasedOverview, seedGradeInputsPlan } from '#tests/helpers/gradeInputsPlan.ts';

// Mocked Imports
// -------------------------
const mockReadGitHeadCommit = jest.fn<(params: { cwd: string }) => Promise<string | undefined>>();

jest.mock('#src/common/git/readGitHeadCommit.ts', () => ({
	readGitHeadCommit: (params: { cwd: string }) => mockReadGitHeadCommit(params),
}));
// -------------------------
const mockReadGitChangedFiles = jest.fn<(params: { cwd: string }) => Promise<string[] | undefined>>();

jest.mock('#src/common/git/readGitChangedFiles.ts', () => ({
	readGitChangedFiles: (params: { cwd: string }) => mockReadGitChangedFiles(params),
}));
// -------------------------

/** The seeded plan folder with both git questions answered, which every case here takes as given: what these tests vary is plan text and decision rows. */
const setupInputs = () => {
	mockReadGitHeadCommit.mockResolvedValue('c0ffee1234567890');
	mockReadGitChangedFiles.mockResolvedValue(['src/a.ts']);

	return seedGradeInputsPlan();
};

/** What a real sha256 digest looks like, as opposed to a placeholder such as `absent`. */
const hexDigest = /^[0-9a-f]{64}$/;

/** One merged decision row. `phases` is left off entirely unless the case declares it, which is how a row written without the field reads. */
const decisionRow = ({ question = 'Which store holds the cache?', phases }: { question?: string; phases?: string[] } = {}): DecisionRow => ({
	source: DecisionSource.Elicitation,
	question,
	options: 'The store / A side table',
	choice: 'The store',
	rationale: 'One place to invalidate.',
	assumption: false,
	...(phases === undefined ? {} : { phases }),
});

/**
 * The phased fixture with its overview replaced by the given text and the given
 * merged rows threaded in. `omitOverview` deletes the overview after the plan
 * paths are taken, so the pass lists an overview it cannot read.
 */
const setupDecisionPlan = ({
	overview = overviewWithLog(),
	decisions = [],
	omitOverview = false,
}: {
	overview?: string;
	decisions?: DecisionRow[];
	omitOverview?: boolean;
} = {}) => {
	const { overviewPath, params } = setupInputs();

	writeFileSync(overviewPath, overview);

	if (omitOverview) {
		rmSync(overviewPath);
	}

	return { overviewPath, params: { ...params, decisions } };
};

/** A single plan — one `plan.md` and no overview — whose text carries a Decision Log, with the given merged rows threaded in. */
const setupSinglePlan = ({ decisions }: { decisions: DecisionRow[] }) => {
	const { overviewPath, params } = setupInputs();
	const planPath = join(dirname(overviewPath), 'plan.md');

	writeFileSync(planPath, overviewWithLog());

	return { params: { ...params, planPaths: [planPath], decisions } };
};

/**
 * The phased fixture with a complete two-phase overview written over its own, so
 * every span the overview credits to a phase is present and joins to a phase
 * file the deliverable actually has.
 */
const setupPhasedOverview = () => {
	const { overviewPath, phaseTwoPath, params } = setupInputs();

	writeFileSync(overviewPath, phasedOverview());

	return { overviewPath, phaseTwoPath, params };
};

/** Each plan file's design hash keyed by basename — the per-file value two passes are compared on. */
const designHashesOf = ({ inputs }: { inputs: GradeInputs }) => Object.fromEntries(inputs.planFiles.map((entry) => [entry.file, entry.designSha256]));

describe('getGradeInputs', () => {
	test('the overview hash of the decision-log part ignores the Decision Log span and moves with text outside it', async () => {
		const { overviewPath, params } = setupDecisionPlan();

		const first = await getGradeInputs(params);

		writeFileSync(overviewPath, overviewWithLog({ log: '| 1 | Elicitation | Which store holds the session cache? |' }));

		const afterLogEdit = await getGradeInputs(params);

		writeFileSync(overviewPath, overviewWithLog({ design: 'The cache sits in front of the store.' }));

		const afterDesignEdit = await getGradeInputs(params);

		expect(first.decisionLog?.overviewDesign).toMatch(hexDigest);
		expect(afterLogEdit.decisionLog?.overviewDesign).toBe(first.decisionLog?.overviewDesign);
		expect(afterDesignEdit.decisionLog?.overviewDesign).not.toBe(first.decisionLog?.overviewDesign);
		// the whole-file hash still follows the log, so exact-input reuse sees every decision
		expect(afterLogEdit.sha256).not.toBe(first.sha256);
	});

	test('an overview with no Decision Log section is hashed whole in the decision-log part', async () => {
		const { params } = setupInputs();

		const inputs = await getGradeInputs(params);

		// with no generated span to leave out and no per-phase span to credit away,
		// every line of the overview is shared design text
		expect(inputs.decisionLog).toStrictEqual({
			overviewDesign: getPlanDesignHash({ plan: parsePlan({ content: '# Overview\n', base: 'overview.md' }) }),
			rows: [],
		});
	});

	test('the decision-log part carries one entry per merged row in record order with its declared phases', async () => {
		const { params } = setupDecisionPlan({
			decisions: [decisionRow(), decisionRow({ question: 'Which phase owns the eviction rule?', phases: ['phase-2.md', 'phase-1.md'] })],
		});

		const inputs = await getGradeInputs(params);

		expect(inputs.decisionLog?.rows).toEqual([
			{ sha256: expect.stringMatching(hexDigest), questionSha256: expect.stringMatching(hexDigest) },
			{ sha256: expect.stringMatching(hexDigest), questionSha256: expect.stringMatching(hexDigest), phases: ['phase-2.md', 'phase-1.md'] },
		]);
	});

	test('a decision row changing only its declared phases moves its row hash and the combined hash', async () => {
		const { params } = setupDecisionPlan();

		const first = await getGradeInputs({ ...params, decisions: [decisionRow({ phases: ['phase-1.md'] })] });
		const second = await getGradeInputs({ ...params, decisions: [decisionRow({ phases: ['phase-2.md'] })] });

		// a phases-only change keeping the combined hash would let a recorded passing
		// grade answer a decision whose declared reach moved
		expect(first.decisionLog?.rows[0]?.sha256).toMatch(hexDigest);
		expect(second.decisionLog?.rows[0]?.sha256).not.toBe(first.decisionLog?.rows[0]?.sha256);
		expect(second.sha256).not.toBe(first.sha256);
	});

	test('a Global constraint row is fingerprinted with no phases whatever it names', async () => {
		const { params } = setupDecisionPlan({
			decisions: [decisionRow({ question: 'Global constraint: every write goes through the store', phases: ['phase-1.md'] })],
		});

		const inputs = await getGradeInputs(params);

		// a global constraint reaches the whole plan, so a phase list it names must
		// never narrow the review a change to it gets
		expect(inputs.decisionLog?.rows).toEqual([{ sha256: expect.stringMatching(hexDigest), questionSha256: expect.stringMatching(hexDigest) }]);
	});

	test('a single plan carries the decision rows and no overview design hash', async () => {
		const { params } = setupSinglePlan({
			decisions: [decisionRow(), decisionRow({ question: 'Which phase owns the eviction rule?', phases: ['phase-1.md'] })],
		});

		const inputs = await getGradeInputs(params);

		// there is no overview, so there is no shared text to compare — and inventing
		// a hash for it would claim a comparison nobody can make
		expect({ planFiles: inputs.planFiles.map((entry) => entry.file), decisionLog: inputs.decisionLog }).toStrictEqual({
			planFiles: ['plan.md'],
			decisionLog: {
				rows: [
					{ sha256: expect.stringMatching(hexDigest), questionSha256: expect.stringMatching(hexDigest) },
					{ sha256: expect.stringMatching(hexDigest), questionSha256: expect.stringMatching(hexDigest), phases: ['phase-1.md'] },
				],
			},
		});
	});

	test('text under a second Decision Log heading counts as overview design text', async () => {
		const { overviewPath, params } = setupDecisionPlan({ overview: overviewWithTwoLogs({ stray: 'A design note filed under a repeated heading.' }) });

		const first = await getGradeInputs(params);

		writeFileSync(overviewPath, overviewWithTwoLogs({ stray: 'A different design note filed under a repeated heading.' }));

		const afterEdit = await getGradeInputs(params);

		// only the span the log check compares may leave the design hash; text the
		// check never reads would otherwise change with no review noticing
		expect(first.decisionLog?.overviewDesign).toMatch(hexDigest);
		expect(afterEdit.decisionLog?.overviewDesign).not.toBe(first.decisionLog?.overviewDesign);
	});

	test('an unreadable overview leaves the overview design hash absent while the rows are still recorded', async () => {
		const { params } = setupDecisionPlan({ decisions: [decisionRow({ phases: ['phase-1.md'] })], omitOverview: true });

		const inputs = await getGradeInputs(params);

		// a hash of content nobody read could compare equal to a later readable pass,
		// while the rows were read from the record rather than from the file
		expect({ decisionLog: inputs.decisionLog, overview: inputs.planFiles.find((entry) => entry.file === 'overview.md') }).toStrictEqual({
			decisionLog: { rows: [{ sha256: expect.stringMatching(hexDigest), questionSha256: expect.stringMatching(hexDigest), phases: ['phase-1.md'] }] },
			overview: { file: 'overview.md', sha256: 'absent' },
		});
	});

	test('every readable plan file carries a design hash and an unreadable one carries none', async () => {
		const { params, phaseTwoPath } = setupPhasedOverview();

		rmSync(phaseTwoPath);

		const inputs = await getGradeInputs(params);

		// an unread file handed a real digest could compare equal to a read one, which
		// would report a reading nobody took as still standing
		expect(inputs.planFiles).toEqual([
			{ file: 'overview.md', sha256: expect.stringMatching(hexDigest), designSha256: expect.stringMatching(hexDigest) },
			{ file: 'phase-1.md', sha256: expect.stringMatching(hexDigest), designSha256: expect.stringMatching(hexDigest) },
			{ file: 'phase-2.md', sha256: 'absent' },
		]);
	});

	test("a rewritten phase row moves that phase's design hash alone", async () => {
		const { overviewPath, params } = setupPhasedOverview();

		const first = await getGradeInputs(params);

		writeFileSync(overviewPath, phasedOverview({ phaseOneScope: 'the core and the store beside it' }));

		const afterRowEdit = await getGradeInputs(params);

		const before = designHashesOf({ inputs: first });
		const after = designHashesOf({ inputs: afterRowEdit });

		// one phase's row is text about that phase alone, so a sync that rewrites it
		// must not spend a reading on the overview or on the phase beside it
		expect(before['phase-1.md']).toMatch(hexDigest);
		expect(after['phase-1.md']).not.toBe(before['phase-1.md']);
		expect({ overview: after['overview.md'], phaseTwo: after['phase-2.md'] }).toStrictEqual({
			overview: before['overview.md'],
			phaseTwo: before['phase-2.md'],
		});
	});

	test('a rewritten Global Constraints section moves no design hash', async () => {
		const { overviewPath, params } = setupPhasedOverview();

		const first = await getGradeInputs(params);

		writeFileSync(overviewPath, phasedOverview({ constraint: 'Every read goes through the store' }));

		const afterConstraintEdit = await getGradeInputs(params);

		// the section is composed from the decision record and guarded by its own
		// blocking check, so a design hash following it would call a reading stale for
		// a reason no reader could act on
		expect(first.planFiles[0]?.designSha256).toMatch(hexDigest);
		expect(designHashesOf({ inputs: afterConstraintEdit })).toStrictEqual(designHashesOf({ inputs: first }));
		expect(afterConstraintEdit.planFiles[0]?.sha256).not.toBe(first.planFiles[0]?.sha256);
	});

	test('a single plan carries the decision rows and moving a row moves the combined hash', async () => {
		const { params } = setupSinglePlan({ decisions: [decisionRow()] });

		const first = await getGradeInputs(params);
		const afterNewRow = await getGradeInputs({
			...params,
			decisions: [decisionRow(), decisionRow({ question: 'Global constraint: every write goes through the store' })],
		});

		// a project-wide rule recorded on a single plan that moved no hash would let
		// the exact-input short-circuit hand back a grade taken without it
		expect(first.decisionLog).toEqual({ rows: [{ sha256: expect.stringMatching(hexDigest), questionSha256: expect.stringMatching(hexDigest) }] });
		expect(afterNewRow.decisionLog?.rows).toHaveLength(2);
		expect(afterNewRow.sha256).not.toBe(first.sha256);
	});
});
