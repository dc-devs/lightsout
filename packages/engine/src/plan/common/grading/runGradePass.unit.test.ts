import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, GapOutcome, type GradeFindingRecord, GradeFindingStatus, GradeMemory, GradeReport, GradeScope } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runGradePass } from '#src/plan/common/grading/runGradePass.ts';
import { getPlanDetectionPass } from '#src/plan/common/utils/getPlanDetectionPass.ts';
import { gradeMemoryPath } from '#src/plan/index.ts';
import { cleanOverviewBody } from '#tests/helpers/cleanOverviewBody.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { gapCheckLensOf } from '#tests/helpers/gapCheckLensOf.ts';
import { inputsFor, passAt } from '#tests/helpers/gradeScopeInputs.ts';
import { secondPhaseBody } from '#tests/helpers/secondPhaseBody.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePhasedPlanDeliverable } from '#tests/helpers/writePhasedPlanDeliverable.ts';

/** The decision both readers ask for — the wording that puts their two findings in one candidate batch. */
const sharedDecision = 'which upload timeout both phases share';

/** What each phase's decisions reader reports: one contradiction, worded from its own side of the seam. */
const firstPhaseGap = {
	area: GapArea.PhaseSeamMismatch,
	gap: 'phase one declares the upload timeout as thirty seconds',
	decision: sharedDecision,
	options: [],
};
const secondPhaseGap = {
	area: GapArea.PhaseSeamMismatch,
	gap: 'phase two declares the upload timeout as ninety seconds',
	decision: sharedDecision,
	options: [],
};

/** The shared defect the judge confirms the two observations are. */
const sharedDefect = 'the two phases disagree on the upload timeout';

/**
 * A stub for the whole pass: the decisions reader of each phase reports that
 * phase's wording of the contradiction and every other reader reports nothing,
 * and the one judge the batch reaches confirms both observations as one defect.
 *
 * The judge is matched first because its prompt carries both plan files' text;
 * a reader is told apart by the file its plan text creates.
 */
const createSharedDefectDriver = (): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		if (invocation.prompt.includes('# Gap-judge input')) {
			return {
				text: JSON.stringify({ verdicts: [{ covers: ['o1', 'o2'], outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick one upload timeout', sharedDefect }] }),
				exitCode: 0,
			};
		}

		const found = invocation.prompt.includes('src/other-thing.ts') ? secondPhaseGap : firstPhaseGap;

		return { text: JSON.stringify({ gaps: gapCheckLensOf(invocation) === GapCheckLens.Decisions ? [found] : [] }), exitCode: 0 };
	},
});

/**
 * A stub for a pass whose readers find nothing: the only finding any judge sees
 * is what the pass carried in, and each judge rules every observation it is
 * handed on its own, `needs-a-human`.
 */
const createQuietReadersDriver = (): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		if (invocation.prompt.includes('# Gap-judge input')) {
			const ids = [...invocation.prompt.matchAll(/^### (o\d+)$/gm)].map((match) => match[1]);

			return {
				text: JSON.stringify({ verdicts: ids.map((id) => ({ covers: [id], outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the rollback owner' })) }),
				exitCode: 0,
			};
		}

		return { text: JSON.stringify({ gaps: [] }), exitCode: 0 };
	},
});

/** A record no judge settled on an earlier pass, on the first phase file. */
const pendingRecord: GradeFindingRecord = {
	id: 'f1',
	phase: 'phase1-core.md',
	lens: GapCheckLens.Decisions,
	area: GapArea.OmittedDecision,
	gap: 'the rollback owner is never named',
	decision: 'who owns the rollback',
	options: [],
	firstSeen: passAt,
	lastSeen: passAt,
	status: GradeFindingStatus.Pending,
	unjudgedReason: 'the judge was rate limited or overloaded',
	observations: [],
	resolutions: [],
	reopened: [],
};

/** A two-phase plan whose memory holds the given records, and every argument one full pass over it takes, with every progress line collected. */
const setupGradePass = async ({ name, driver, findings }: { name: string; driver: Driver; findings: GradeFindingRecord[] }) => {
	const cwd = setupConsumerRepo();
	const messages: string[] = [];

	writePhasedPlanDeliverable({
		cwd,
		name,
		files: {
			'overview.md': cleanOverviewBody(),
			'phase1-core.md': cleanPlanBody({ title: 'Graded Plan', reference: true }),
			'phase2-extra.md': secondPhaseBody(),
		},
	});

	const pass = await getPlanDetectionPass({ cwd, name });
	const memory: GradeMemory = { planName: name, findings, nextFindingNumber: findings.length + 1, updatedAt: passAt };

	return {
		args: {
			params: { cwd, driver, name },
			pass,
			selected: pass.files,
			scope: GradeScope.Full,
			focusedOn: [],
			scopeReason: 'nothing was on record to narrow against',
			inputs: inputsFor({ planFiles: [], sha256: 'pass-1' }),
			memory,
			structural: [],
			stamp: { commit: undefined, treeDirty: undefined },
			progress: (message: string) => {
				messages.push(message);
			},
		},
		messages,
		gradePath: join(pass.workspaceDir, 'grade.json'),
		memoryPath: gradeMemoryPath({ cwd, name }),
	};
};

/** A two-phase plan with an empty memory, and every argument one full pass over it takes. */
const setupSharedDefect = async ({ name }: { name: string }) => setupGradePass({ name, driver: createSharedDefectDriver(), findings: [] });

describe('runGradePass', () => {
	test('reports one blocker and stores one record for a confirmed shared defect', async () => {
		const { args, gradePath, memoryPath } = await setupSharedDefect({ name: 'shared-defect' });

		await runGradePass(args);

		const report = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));
		const memory = GradeMemory.parse(JSON.parse(readFileSync(memoryPath, 'utf8')));
		const observations = [
			expect.objectContaining({ phase: 'phase1-core.md', lens: GapCheckLens.Decisions, gap: firstPhaseGap.gap }),
			expect.objectContaining({ phase: 'phase2-extra.md', lens: GapCheckLens.Decisions, gap: secondPhaseGap.gap }),
		];

		// two readers in two phase files described one contradiction: a human reads
		// one repair item naming both places, and the memory holds one obligation
		expect({ gaps: report.gaps, findings: memory.findings }).toEqual({
			gaps: [expect.objectContaining({ outcome: GapOutcome.NeedsAHuman, findingId: 'f1', sharedDefect, observations })],
			findings: [expect.objectContaining({ id: 'f1', status: GradeFindingStatus.Open, sharedDefect, observations })],
		});
	});

	test('carries a pending record into the judge stage and records the ruling it gets', async () => {
		const { args, messages, memoryPath } = await setupGradePass({ name: 'carried-pending', driver: createQuietReadersDriver(), findings: [pendingRecord] });

		const result = await runGradePass(args);

		const memory = GradeMemory.parse(JSON.parse(readFileSync(memoryPath, 'utf8')));
		// no reader re-reported it, yet it is judged rather than lost: the run says it
		// was carried in, and the ruling lands on its own record instead of a second one,
		// whose stale unjudged reason is gone from the file on disk
		expect({
			carriedLine: messages.some((message) => message.includes('1 pending finding(s) carried in for a judge')),
			gaps: result.report.gaps,
			findings: memory.findings,
			unjudgedReasons: memory.findings.map((finding) => finding.unjudgedReason),
		}).toEqual({
			carriedLine: true,
			gaps: [expect.objectContaining({ findingId: 'f1', outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the rollback owner' })],
			findings: [expect.objectContaining({ id: 'f1', status: GradeFindingStatus.Open, disposition: GapOutcome.NeedsAHuman })],
			unjudgedReasons: [undefined],
		});
	});
});
