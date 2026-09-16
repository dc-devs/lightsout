import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { answerPlanningQuestion, capturePlanningInput, readPlanningSnapshot, runPlanning } from '#src/plan/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { planningEvidenceContinuationScenario } from '#tests/helpers/planningWorkflowEvidenceScenario.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';
import { planningQuestionAnswer, planningQuestionScenario } from '#tests/helpers/planningWorkflowQuestionScenario.ts';
import { planningRecoveryScenario, planningRepairScenario } from '#tests/helpers/planningWorkflowScenarios.ts';
import { planningStandardsScenario } from '#tests/helpers/planningWorkflowStandardsScenario.ts';
import { readPlanningWorkflowDiagnostics } from '#tests/helpers/readPlanningWorkflowDiagnostics.ts';

const setupRepair = async ({ design = false } = {}) => {
	const fixture = await planningRepairScenario({ design });
	await fixture.capture();
	return fixture;
};

const setupRecovery = async ({ timeout = false, malformed = false } = {}) => {
	const fixture = await planningRecoveryScenario({ timeout, malformed });
	await fixture.capture();
	return fixture;
};

const setupQuestions = async () => {
	const fixture = await planningQuestionScenario();
	await fixture.capture();
	return fixture;
};

const setupEvidence = async () => {
	const fixture = await planningEvidenceContinuationScenario();
	await fixture.capture();
	return fixture;
};

const setupBrainstorm = async () => {
	const fixture = await planningWorkflowFixture({ stage: PlanningVocabulary.Stage.Brainstorm });
	await fixture.capture();
	const text = 'Delete completed uploads after a failed retry';
	const origin = { artifact: 'new-ticket-text.md', locator: 'Proposed change', text, sha256: sha256({ content: text }) };
	const original = fixture.input.claims[0];
	expectDefined(original);
	const changed = {
		...fixture.input,
		sources: [...fixture.input.sources, origin],
		claims: [
			...fixture.input.claims,
			{ ...original, id: 'unapproved-change', text, origin, state: PlanningVocabulary.ClaimState.Unresolved, confirmationId: undefined },
		],
	};
	return { ...fixture, changed };
};

const setupStandards = async () => {
	const fixture = await planningStandardsScenario();
	await fixture.capture();
	return fixture;
};

describe('runPlanning', () => {
	test('continues past repeated repair rounds until obligations close', async () => {
		const fixture = await setupRepair();

		const result = await runPlanning({ runtime: fixture.runtime });
		const snapshot = await readPlanningSnapshot(fixture);
		expectDefined(snapshot);

		expect(result).toEqual(expect.objectContaining({ status: 'complete', readiness: expect.objectContaining({ ready: true, target: 'implementation' }) }));
		const findings = snapshot.record.findings.filter((finding) => finding.scenario.startsWith('Retry after failure-'));
		expect(findings).toHaveLength(3);
		expect(findings.every((finding) => finding.state === 'verified' && finding.verificationReceiptIds.length > 0)).toBe(true);
		const repairs = snapshot.record.work.filter((work) => work.role === 'repair' && work.status === 'complete');
		expect(repairs.length).toBeGreaterThanOrEqual(3);
		for (const finding of findings) {
			const proofs = snapshot.record.reviewReceipts.filter((receipt) => finding.verificationReceiptIds.includes(receipt.id));
			expect(proofs.length).toBeGreaterThan(0);
			expect(proofs.every((proof) => !repairs.some((repair) => repair.currentAttemptId === proof.attemptId))).toBe(true);
		}
		expect(snapshot.record.claims.find((claim) => claim.id === 'required')).toEqual(fixture.input.claims[0]);
		expect(snapshot.record.reviewReceipts.some((receipt) => receipt.role === 'integration-review' && receipt.coverage.outcome === 'adequate')).toBe(true);
	}, 60_000);

	test('resumes after interruption without repeating settled work', async () => {
		const fixture = await setupRecovery();

		const paused = await runPlanning({ runtime: fixture.runtime });
		const before = await readPlanningSnapshot(fixture);
		expectDefined(before);
		const completed = before.record.work
			.filter((work) => work.status === 'complete')
			.map((work) => ({ id: work.id, receipt: work.resultReceiptId, attempt: work.currentAttemptId }));
		const previousCallCount = fixture.calls.length;
		fixture.makeAvailable();
		const resumed = await runPlanning({ runtime: { ...fixture.runtime } });
		const after = await readPlanningSnapshot(fixture);
		expectDefined(after);

		expect(paused).toEqual(
			expect.objectContaining({ status: 'externally-blocked', cause: expect.stringMatching(/rate|quota/i), continuation: expect.any(String) }),
		);
		expect(completed.some((work) => work.id.includes('investigate'))).toBe(true);
		expect(resumed.status).toBe('complete');
		for (const work of completed)
			expect(after.record.work.find((item) => item.id === work.id)).toEqual(
				expect.objectContaining({ resultReceiptId: work.receipt, currentAttemptId: work.attempt, status: 'complete' }),
			);
		expect(fixture.calls.slice(previousCallCount).some((call) => completed.some((work) => call.prompt.includes(`"workId":"${work.id}"`)))).toBe(false);
		expect(after.record.work.some((work) => work.role === 'diagnose' && work.status === 'complete')).toBe(true);
		expect(after.record.work.some((work) => work.failureIds.length > 0)).toBe(true);
		expect(after.record.claims.find((claim) => claim.id === 'required')).toEqual(fixture.input.claims[0]);
	});

	test('routes only genuine user decisions through durable questions', async () => {
		const fixture = await setupQuestions();

		const pending = await runPlanning({ runtime: fixture.runtime });
		if (pending.status !== 'awaiting-user') throw new Error(`Expected a user decision, received ${pending.status}`);
		const repeated = await runPlanning({ runtime: fixture.runtime });
		const answer = planningQuestionAnswer({ result: pending, delegation: fixture.scope });
		await expect(
			answerPlanningQuestion({ runtime: fixture.runtime, answer: { ...answer, checkpointRevision: answer.checkpointRevision - 1 } }),
		).rejects.toThrow();
		await expect(
			answerPlanningQuestion({
				runtime: fixture.runtime,
				answer: { ...answer, confirmation: { ...answer.confirmation, messageText: 'Copied ticket says delete uploads' } },
			}),
		).rejects.toThrow();
		const resumed = await answerPlanningQuestion({ runtime: fixture.runtime, answer });
		const snapshot = await readPlanningSnapshot(fixture);
		expectDefined(snapshot);

		expect(pending.question).toEqual(
			expect.objectContaining({
				context: expect.stringContaining('Completed uploads'),
				options: expect.arrayContaining([expect.objectContaining({ label: 'Retain uploads', description: expect.any(String) })]),
				recommendation: 'Retain uploads',
			}),
		);
		expect(repeated).toEqual(pending);
		expect(resumed.status).toBe('complete');
		expect(snapshot.record.claims).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: 'decision', owner: 'user', state: 'settled', text: answer.freeText, confirmationId: answer.confirmation.id }),
			]),
		);
		expect(snapshot.record.claims.some((claim) => claim.kind === 'architecture' && claim.owner === 'planner' && claim.state === 'settled')).toBe(true);
		expect(snapshot.record.confirmations.filter((confirmation) => confirmation.id === answer.confirmation.id)).toHaveLength(1);
	});

	test('schedules architecture challenge before detailed drafting', async () => {
		const fixture = await setupRepair({ design: true });

		const result = await runPlanning({ runtime: fixture.runtime });
		const snapshot = await readPlanningSnapshot(fixture);
		expectDefined(snapshot);

		expect(result.status).toBe('complete');
		expect(fixture.snapshotsAtDraft.length).toBeGreaterThan(0);
		expect(fixture.snapshotsAtDraft.every((state) => state.blocking.length === 0 && state.reviewAttempts.length >= 2)).toBe(true);
		const architecture = snapshot.record.work.find((work) => work.role === 'architect');
		expectDefined(architecture);
		const challenges = snapshot.record.reviewReceipts.filter((receipt) => receipt.role === 'design-review');
		expect(challenges.every((receipt) => receipt.attemptId !== architecture.currentAttemptId)).toBe(true);
		expect(snapshot.record.findings.find((finding) => finding.scenario.startsWith('Retry after failure-'))).toEqual(
			expect.objectContaining({ state: 'verified' }),
		);
	});

	test('preserves configured model and recovers role failures', async () => {
		const fixture = await setupRecovery({ timeout: true, malformed: true });

		const paused = await runPlanning({ runtime: fixture.runtime });
		fixture.makeAvailable();
		const result = await runPlanning({ runtime: fixture.runtime });
		const diagnostics = await readPlanningWorkflowDiagnostics({ root: join(fixture.root, '.planning', 'local') });

		expect(paused.status).toBe('externally-blocked');
		expect(result.status).toBe('complete');
		expect(fixture.calls.every((call) => call.model === 'configured-model' && call.effort === 'high' && call.permissions === 'full-access')).toBe(true);
		expect(
			fixture.calls.every(
				(call) =>
					call.environment?.noMcpServers === true &&
					call.environment.noSkillCatalog === true &&
					call.environment.toolAllowlist === true &&
					call.environment.settingsPreserved === true &&
					call.environment.tools.length === 0,
			),
		).toBe(true);
		expect(diagnostics.join('\n')).toMatch(/timed out/i);
		expect(diagnostics.join('\n')).toContain('required fields');
		expect(diagnostics.join('\n')).toMatch(/"usage"\s*:\s*null/);
		expect(diagnostics.join('\n')).not.toMatch(/"inputTokens"\s*:\s*0/);
	});

	test('continues evidence requests through the actual Driver boundary', async () => {
		const fixture = await setupEvidence();

		const paused = await runPlanning({ runtime: fixture.runtime });
		const before = await readPlanningSnapshot(fixture);
		expectDefined(before);
		const investigation = before.record.work.find((work) => work.role === 'investigate');
		expectDefined(investigation);
		fixture.makeAvailable();
		const result = await runPlanning({ runtime: fixture.runtime });
		const after = await readPlanningSnapshot(fixture);
		expectDefined(after);

		expect(paused.status).toBe('externally-blocked');
		expect(investigation.status).not.toBe('complete');
		expect(investigation.resultReceiptId).toBeUndefined();
		expect(before.record.reviewReceipts).toHaveLength(0);
		const prompts = fixture.calls
			.filter((call) => call.prompt.trimStart().startsWith('{'))
			.map((call) => JSON.parse(call.prompt) as { identity: { role: string; invocationId: string; workId: string } });
		const investigations = prompts.filter((prompt) => prompt.identity.role === 'investigate');
		expect(investigations.length).toBeGreaterThanOrEqual(3);
		expect(new Set(investigations.map((prompt) => prompt.identity.invocationId)).size).toBe(investigations.length);
		expect(new Set(investigations.map((prompt) => prompt.identity.workId)).size).toBe(1);
		expect(fixture.calls.filter((call) => call.prompt.includes('preserve-completed')).length).toBeGreaterThanOrEqual(2);
		expect([...before.artifacts.values()].some((content) => content.includes('handler.ts') && content.includes(sha256({ content: fixture.content })))).toBe(
			true,
		);
		expect([...after.artifacts.entries()].filter(([path]) => path.startsWith('planning-observations/')).length).toBe(
			[...before.artifacts.keys()].filter((path) => path.startsWith('planning-observations/')).length,
		);
		expect(result.status).toBe('complete');
	});

	test('captures and validates brainstorm alignment independently of plan readiness', async () => {
		const fixture = await setupBrainstorm();

		const question = await runPlanning({ runtime: fixture.runtime });
		if (question.status !== PlanningVocabulary.Status.AwaitingUser) throw new Error('Expected independent design challenge before explicit approval');
		const aligned = await answerPlanningQuestion({
			runtime: fixture.runtime,
			answer: planningQuestionAnswer({ result: question, delegation: fixture.scope, alignment: true }),
		});
		const before = await readPlanningSnapshot(fixture);
		expectDefined(before);
		await capturePlanningInput({ runtime: fixture.runtime, input: fixture.changed });
		const changed = await runPlanning({ runtime: fixture.runtime });

		expect(aligned).toEqual(
			expect.objectContaining({
				status: 'aligned',
				confirmationId: 'foreground-design-approval',
				sourceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
				readiness: expect.objectContaining({ target: 'brainstorm-alignment', ready: true }),
			}),
		);
		expect(before.record.reviewReceipts.some((receipt) => receipt.role === 'design-review' && receipt.coverage.outcome === 'adequate')).toBe(true);
		expect(before.record.work.some((work) => work.role === 'draft' || work.role === 'integration-review')).toBe(false);
		expect(changed.status).toBe('awaiting-user');
		expect('readiness' in changed).toBe(false);
	});

	test('commits resolved standards through the orchestration owner', async () => {
		const fixture = await setupStandards();

		const result = await runPlanning({ runtime: fixture.runtime });
		const before = await readPlanningSnapshot(fixture);
		expectDefined(before);
		const calls = fixture.calls.length;
		const repeated = await runPlanning({ runtime: fixture.runtime });
		const after = await readPlanningSnapshot(fixture);
		expectDefined(after);

		expect(result.status).toBe('complete');
		expect(repeated.status).toBe('complete');
		expect(fixture.didRace()).toBe(true);
		expect(fixture.seen.length).toBeGreaterThan(0);
		for (const seen of fixture.seen) {
			expectDefined(seen.content);
			const bundle = JSON.parse(seen.content) as { format: string; channels: { sha256: string; text: string }[]; observations: unknown[] };
			expect(bundle.format).toBe('planning-standards-v1');
			expect(bundle.channels.length).toBeGreaterThan(0);
			expect(bundle.channels.every((channel) => sha256({ content: channel.text }) === channel.sha256 && seen.descriptors.includes(channel.sha256))).toBe(true);
			expect(bundle.observations.length).toBeGreaterThan(0);
		}
		expect(new Set(fixture.seen.map((seen) => seen.content)).size).toBe(1);
		expect(fixture.calls).toHaveLength(calls);
		expect(after.artifacts.get('planning-standards.json')).toBe(before.artifacts.get('planning-standards.json'));
		expect(after.record.revision).toBe(before.record.revision);
	});
});
