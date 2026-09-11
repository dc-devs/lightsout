import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type DecisionRow, DecisionSource, Effort, LightsoutConfig } from '#src/contracts/index.ts';
import { getGradeInputs } from '#src/plan/common/scope/getGradeInputs.ts';

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

type GradeInputsParams = Parameters<typeof getGradeInputs>[0];

/** A parsed consumer config differing only in the one plan-relevant key each case varies. */
const configOf = ({ packagesDir = 'packages' }: { packagesDir?: string } = {}) =>
	LightsoutConfig.parse({ gates: { check: 'true', test: 'true', 'test-coverage': false }, 'packages-dir': packagesDir });

/**
 * A temp repo holding one changed source file and a three-file phased plan, plus
 * the arguments one pass measures it with. `probe: 'unread'` is a pass taken
 * where neither git question could be answered, which is not the same as one
 * taken on a clean tree.
 */
const setupInputs = ({ probe = 'read', changed = ['src/a.ts'] }: { probe?: 'read' | 'unread'; changed?: string[] } = {}) => {
	mockReadGitHeadCommit.mockResolvedValue(probe === 'read' ? 'c0ffee1234567890' : undefined);
	mockReadGitChangedFiles.mockResolvedValue(probe === 'read' ? changed : undefined);

	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-grade-inputs-'));
	const planDir = join(cwd, '.lightsout', 'plans', 'p');

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src', 'a.ts'), 'export const a = 1;\n');

	mkdirSync(planDir, { recursive: true });

	const overviewPath = join(planDir, 'overview.md');
	const phaseOnePath = join(planDir, 'phase-1.md');
	const phaseTwoPath = join(planDir, 'phase-2.md');

	writeFileSync(overviewPath, '# Overview\n');
	writeFileSync(phaseOnePath, '# Phase 1\n');
	writeFileSync(phaseTwoPath, '# Phase 2\n');

	const params: GradeInputsParams = {
		cwd,
		planPaths: [overviewPath, phaseOnePath, phaseTwoPath],
		decisions: [],
		standards: 'the supplemental standards text',
		config: configOf(),
		model: 'claude-opus-5',
		effort: Effort.High,
	};

	return { cwd, phaseTwoPath, params };
};

/**
 * The fingerprint one pass takes with the reader brief replaced by the given
 * text. The module is required fresh inside `isolateModules`, so a prompt read
 * once at module load is genuinely re-taken rather than served from the first
 * require — which is what makes this comparison state the prompt's own effect
 * whichever way the hash is assembled.
 */
const fingerprintWithReaderBrief = async ({ brief, params }: { brief: string; params: GradeInputsParams }) => {
	let readInputs = getGradeInputs;

	jest.isolateModules(() => {
		jest.doMock('#src/agents/prompts/planGapCheck.md', () => ({ __esModule: true, default: brief }));
		readInputs = (require('#src/plan/common/scope/getGradeInputs.ts') as { getGradeInputs: typeof getGradeInputs }).getGradeInputs;
	});

	const inputs = await readInputs(params);

	jest.dontMock('#src/agents/prompts/planGapCheck.md');

	return inputs;
};

/** What a real sha256 digest looks like, as opposed to a placeholder such as `absent`. */
const hexDigest = /^[0-9a-f]{64}$/;

/**
 * An overview whose design text and generated Decision Log can each be varied
 * alone, so a comparison states which of the two a hash follows.
 */
const overviewWithLog = ({
	design = 'The cache sits beside the store.',
	log = '| 1 | Elicitation | Which store holds the cache? |',
}: {
	design?: string;
	log?: string;
} = {}) =>
	[
		'# Overview',
		'',
		'## Context',
		'',
		design,
		'',
		'## Decision Log',
		'',
		'| # | Source | Decision / Question |',
		'|---|--------|---------------------|',
		log,
		'',
		'## Global Constraints',
		'',
		'- None',
		'',
	].join('\n');

/**
 * An overview carrying two `## Decision Log` headings. The parser locates the
 * last section of a repeated name, so `stray` sits under the heading
 * `decisionLogRange` does not locate — the one the log-matches-record check
 * never compares against the record.
 */
const overviewWithTwoLogs = ({ stray }: { stray: string }) =>
	[
		'# Overview',
		'',
		'## Decision Log',
		'',
		stray,
		'',
		'## Context',
		'',
		'The cache sits beside the store.',
		'',
		'## Decision Log',
		'',
		'| # | Source | Decision / Question |',
		'|---|--------|---------------------|',
		'| 1 | Elicitation | Which store holds the cache? |',
		'',
		'## Global Constraints',
		'',
		'- None',
		'',
	].join('\n');

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
	const { params } = setupInputs();
	const [overviewPath = ''] = params.planPaths;

	writeFileSync(overviewPath, overview);

	if (omitOverview) {
		rmSync(overviewPath);
	}

	return { overviewPath, params: { ...params, decisions } };
};

/** A single plan — one `plan.md` and no overview — whose text carries a Decision Log, with the given merged rows threaded in. */
const setupSinglePlan = ({ decisions }: { decisions: DecisionRow[] }) => {
	const { params } = setupInputs();
	const [overviewPath = ''] = params.planPaths;
	const planPath = join(dirname(overviewPath), 'plan.md');

	writeFileSync(planPath, overviewWithLog());

	return { params: { ...params, planPaths: [planPath], decisions } };
};

describe('getGradeInputs', () => {
	test('the fingerprint is stable across passes and moves when a plan file changes', async () => {
		const { params, phaseTwoPath } = setupInputs();

		const first = await getGradeInputs(params);
		const second = await getGradeInputs(params);

		writeFileSync(phaseTwoPath, '# Phase 2\n\nOne more decision.\n');

		const afterEdit = await getGradeInputs(params);

		expect(second.sha256).toBe(first.sha256);
		expect(afterEdit.sha256).not.toBe(first.sha256);
		expect(first.planFiles.map((entry) => entry.file)).toStrictEqual(['overview.md', 'phase-1.md', 'phase-2.md']);
		expect(afterEdit.planFiles[2]?.sha256).not.toBe(first.planFiles[2]?.sha256);
	});

	test('every non-plan-text input is part of the fingerprint', async () => {
		const { params } = setupInputs();

		const baseline = await getGradeInputs(params);
		const withStandards = await getGradeInputs({ ...params, standards: 'a different standards text' });
		const withConfig = await getGradeInputs({ ...params, config: configOf({ packagesDir: 'apps' }) });
		const withModel = await getGradeInputs({ ...params, model: 'claude-sonnet-5' });
		const withEffort = await getGradeInputs({ ...params, effort: Effort.Max });
		const withFirstBrief = await fingerprintWithReaderBrief({ brief: 'the reader brief as it reads today', params });
		const withSecondBrief = await fingerprintWithReaderBrief({ brief: 'the reader brief after an edit', params });

		expect(withStandards.sha256).not.toBe(baseline.sha256);
		expect(withConfig.sha256).not.toBe(baseline.sha256);
		expect(withModel.sha256).not.toBe(baseline.sha256);
		expect(withEffort.sha256).not.toBe(baseline.sha256);
		expect(withSecondBrief.sha256).not.toBe(withFirstBrief.sha256);
	});

	test('an unread git probe leaves its field absent rather than empty', async () => {
		const { params } = setupInputs({ probe: 'unread' });

		const inputs = await getGradeInputs(params);

		// "nobody looked" and "nothing changed" must never encode the same way, or a
		// focused pass could narrow against a code state nobody measured
		expect({ gradedCommit: inputs.gradedCommit, changedFiles: inputs.changedFiles }).toStrictEqual({ gradedCommit: undefined, changedFiles: undefined });
	});

	test('a changed file that cannot be read is fingerprinted as absent', async () => {
		const { params } = setupInputs({ changed: ['src/a.ts', 'src/deleted.ts'] });

		const inputs = await getGradeInputs(params);

		// a file the probe reports and the disk no longer holds still has to be
		// encoded; a real digest for it would compare equal to content it once held
		expect(inputs.changedFiles).toEqual([
			{ path: 'src/a.ts', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
			{ path: 'src/deleted.ts', sha256: 'absent' },
		]);
	});

	test('the overview hash of the decision-log part ignores the Decision Log span and moves with text outside it', async () => {
		const { overviewPath, params } = setupDecisionPlan();

		const first = await getGradeInputs(params);

		writeFileSync(overviewPath, overviewWithLog({ log: '| 1 | Elicitation | Which store holds the session cache? |' }));

		const afterLogEdit = await getGradeInputs(params);

		writeFileSync(overviewPath, overviewWithLog({ design: 'The cache sits in front of the store.' }));

		const afterDesignEdit = await getGradeInputs(params);

		expect(first.decisionLog?.overview).toMatch(hexDigest);
		expect(afterLogEdit.decisionLog?.overview).toBe(first.decisionLog?.overview);
		expect(afterDesignEdit.decisionLog?.overview).not.toBe(first.decisionLog?.overview);
		// the whole-file hash still follows the log, so exact-input reuse sees every decision
		expect(afterLogEdit.sha256).not.toBe(first.sha256);
	});

	test('an overview with no Decision Log section is hashed whole in the decision-log part', async () => {
		const { params } = setupInputs();

		const inputs = await getGradeInputs(params);

		// with no span to leave out, every line of the overview is design text
		expect(inputs.decisionLog).toStrictEqual({ overview: createHash('sha256').update('# Overview\n').digest('hex'), rows: [] });
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

	test('a single plan carries no decision-log part', async () => {
		const { params } = setupSinglePlan({
			decisions: [decisionRow(), decisionRow({ question: 'Which phase owns the eviction rule?', phases: ['phase-1.md'] })],
		});

		const inputs = await getGradeInputs(params);

		expect({ planFiles: inputs.planFiles.map((entry) => entry.file), decisionLog: inputs.decisionLog }).toStrictEqual({
			planFiles: ['plan.md'],
			decisionLog: undefined,
		});
	});

	test('text under a second Decision Log heading counts as overview design text', async () => {
		const { overviewPath, params } = setupDecisionPlan({ overview: overviewWithTwoLogs({ stray: 'A design note filed under a repeated heading.' }) });

		const first = await getGradeInputs(params);

		writeFileSync(overviewPath, overviewWithTwoLogs({ stray: 'A different design note filed under a repeated heading.' }));

		const afterEdit = await getGradeInputs(params);

		// only the span the log check compares may leave the design hash; text the
		// check never reads would otherwise change with no review noticing
		expect(first.decisionLog?.overview).toMatch(hexDigest);
		expect(afterEdit.decisionLog?.overview).not.toBe(first.decisionLog?.overview);
	});

	test('an unreadable overview leaves the decision-log part absent', async () => {
		const { params } = setupDecisionPlan({ decisions: [decisionRow({ phases: ['phase-1.md'] })], omitOverview: true });

		const inputs = await getGradeInputs(params);

		// a hash of content nobody read could compare equal to a later readable pass
		expect({ decisionLog: inputs.decisionLog, overview: inputs.planFiles.find((entry) => entry.file === 'overview.md') }).toStrictEqual({
			decisionLog: undefined,
			overview: { file: 'overview.md', sha256: 'absent' },
		});
	});
});
