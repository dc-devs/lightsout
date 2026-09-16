import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary, RunStatus } from '#src/contracts/index.ts';
import { commitPlanningSnapshot } from '#src/plan/index.ts';
import { planningCompletedFixture } from '#tests/helpers/planningCompletedFixture.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

/** One local call record, in the shape `recordPlanningUsage` writes. */
const callRecord = ({ callId, workId, attemptId, usage }: { callId: string; workId: string; attemptId: string; usage: unknown }) => ({
	callId,
	workId,
	attemptId,
	startedAt: 0,
	endedAt: 4_000,
	elapsedMs: 4_000,
	usage,
	exitCode: 0,
	rateLimited: false,
	text: 'recorded planning call',
});

/**
 * A plan whose only record is the canonical store — no `planning-progress.json`
 * anywhere.
 *
 * One committed generation holds a saved investigation, the repair an
 * independent reviewer verified, a recheck the changed upload contract reopened,
 * and a repair still running under an open blocking finding. Beside it: one
 * billed call written twice, as a restored generation replays it; one call whose
 * Driver reported no usage at all; and a failed implement run.
 */
export const planningCanonicalDiagnosticsFixture = async (): Promise<{ cwd: string; name: string }> => {
	const { cwd, name, root, scope, candidate } = await planningCompletedFixture();
	const changedContract = sha256({ content: 'changed upload contract' });
	const recheck = {
		id: 'architect-recheck',
		role: PlanningVocabulary.Role.Architect,
		stage: PlanningVocabulary.Stage.Implementation,
		scope,
		prerequisiteIds: ['author'],
		inputDigest: changedContract,
		status: PlanningVocabulary.WorkState.Pending,
		attemptSequence: 0,
		failureIds: [],
		diagnosisIds: [],
		assignment: 'Recheck the changed upload contract',
	};

	candidate.record.findings.push({
		id: 'contract-drift',
		observationIds: ['upload-contract'],
		scope,
		scenario: 'The upload contract changed after the investigation was saved',
		consequence: 'The saved conclusion no longer covers it',
		missingObligation: 'Recheck the changed contract',
		severity: PlanningVocabulary.Severity.Blocking,
		owner: PlanningVocabulary.Owner.Planner,
		state: PlanningVocabulary.FindingState.Open,
		resolutionClaimIds: [],
		resolutionArtifacts: [],
		verificationReceiptIds: [],
		citations: [],
	});
	candidate.record.work.push(recheck, {
		...recheck,
		id: 'repair-upload-contract',
		role: PlanningVocabulary.Role.Repair,
		prerequisiteIds: ['reviewer'],
		status: PlanningVocabulary.WorkState.Running,
		attemptSequence: 2,
		currentAttemptId: 'attempt-repair',
		failureIds: ['contract-drift'],
		assignment: 'Repair the plan against the changed upload contract',
	});

	const committed = await commitPlanningSnapshot({ cwd, name, ...candidate });

	if (!committed.committed) throw new Error('The canonical diagnostics fixture lost its transaction');

	const local = join(root, '.planning', 'local');
	const billed = callRecord({
		callId: 'call-billed',
		workId: 'author',
		attemptId: 'attempt-author',
		usage: { inputTokens: 1_200, outputTokens: 300, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.25 },
	});
	const unbilled = callRecord({ callId: 'call-unbilled', workId: 'repair-upload-contract', attemptId: 'attempt-repair', usage: null });

	await mkdir(local, { recursive: true });
	await writeFile(join(local, 'call-billed.json'), canonicalJson({ value: billed }));
	// The same call under a second name: one call billed twice is a lie about what planning cost.
	await writeFile(join(local, 'call-billed-restored.json'), canonicalJson({ value: billed }));
	await writeFile(join(local, 'call-unbilled.json'), canonicalJson({ value: unbilled }));
	await seedRunDir({ cwd, manifest: { runId: 'implement-demo', status: RunStatus.Failed, plan: `.lightsout/plans/${name}/plan.md` } });

	return { cwd, name };
};
