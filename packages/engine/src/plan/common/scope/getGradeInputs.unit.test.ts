import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { Effort } from '#src/contracts/Effort.ts';
import { getGradeInputs } from '#src/plan/common/scope/getGradeInputs.ts';
import { gradeInputsConfig, seedGradeInputsPlan } from '#tests/helpers/gradeInputsPlan.ts';

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

/**
 * The seeded plan folder with both git questions answered per this case.
 * `probe: 'unread'` is a pass taken where neither could be answered, which is
 * not the same as one taken on a clean tree.
 */
const setupInputs = ({ probe = 'read', changed = ['src/a.ts'] }: { probe?: 'read' | 'unread'; changed?: string[] } = {}) => {
	mockReadGitHeadCommit.mockResolvedValue(probe === 'read' ? 'c0ffee1234567890' : undefined);
	mockReadGitChangedFiles.mockResolvedValue(probe === 'read' ? changed : undefined);

	return seedGradeInputsPlan();
};

/**
 * A planning worktree and the checkout planning was launched from, each a temp
 * directory holding its own `src/a.ts`, with the git probes answering per
 * directory. `advanceLaunchingCheckout` moves the launching checkout's HEAD and
 * edits and adds source there, as another agent working in it would.
 */
const setupWorktreeAndLaunchingCheckout = () => {
	const worktree = mkdtempSync(join(tmpdir(), 'lightsout-grade-inputs-worktree-'));
	const launching = mkdtempSync(join(tmpdir(), 'lightsout-grade-inputs-launching-'));
	const heads = new Map([
		[worktree, '1111111111111111111111111111111111111111'],
		[launching, '2222222222222222222222222222222222222222'],
	]);
	const changed = new Map([
		[worktree, ['src/a.ts']],
		[launching, ['src/a.ts']],
	]);

	mockReadGitHeadCommit.mockImplementation(async ({ cwd }) => heads.get(cwd));
	mockReadGitChangedFiles.mockImplementation(async ({ cwd }) => changed.get(cwd));

	for (const checkout of [worktree, launching]) {
		mkdirSync(join(checkout, 'src'), { recursive: true });
		writeFileSync(join(checkout, 'src', 'a.ts'), 'export const a = 1;\n');
	}

	const planDir = join(worktree, '.lightsout', 'work-orders', 'p', 'plans');
	const planPath = join(planDir, 'plan.md');

	mkdirSync(planDir, { recursive: true });
	writeFileSync(planPath, '# Plan\n');

	const params: GradeInputsParams = {
		cwd: worktree,
		planPaths: [planPath],
		decisions: [],
		standards: 'the supplemental standards text',
		config: gradeInputsConfig(),
		model: 'claude-opus-5',
		effort: Effort.High,
	};

	const advanceLaunchingCheckout = () => {
		heads.set(launching, '3333333333333333333333333333333333333333');
		changed.set(launching, ['src/a.ts', 'src/b.ts']);
		writeFileSync(join(launching, 'src', 'a.ts'), 'export const a = 2;\n');
		writeFileSync(join(launching, 'src', 'b.ts'), 'export const b = 1;\n');
	};

	return { params, advanceLaunchingCheckout };
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
		const withConfig = await getGradeInputs({ ...params, config: gradeInputsConfig({ packagesDir: 'apps' }) });
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

	test('fingerprints the planning worktree alone, unmoved by the launching checkout advancing', async () => {
		const { params, advanceLaunchingCheckout } = setupWorktreeAndLaunchingCheckout();

		const before = await getGradeInputs(params);

		advanceLaunchingCheckout();

		const after = await getGradeInputs(params);

		expect({ sha256: after.sha256, gradedCommit: after.gradedCommit }).toStrictEqual({
			sha256: before.sha256,
			gradedCommit: '1111111111111111111111111111111111111111',
		});
	});
});
