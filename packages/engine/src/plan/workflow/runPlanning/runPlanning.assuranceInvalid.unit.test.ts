import { expect, test } from '@jest/globals';
import { PlanningRoleResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { answerPlanningQuestion, readPlanningSnapshot, runPlanning } from '#src/plan/index.ts';
import { planningUnknownWorkflowFixture } from '#tests/helpers/planningUnknownWorkflowFixture.ts';
import { planningQuestionAnswer } from '#tests/helpers/planningWorkflowQuestionScenario.ts';

test.each(['omitted', 'dependency', 'claim', 'acquired-missing', 'acquired-unknown'])(
	'rejects unknown-reach certification lacking the assigned observed support: %s',
	async (variant) => {
		const fixture = await planningUnknownWorkflowFixture();
		const invoke = fixture.runtime.driver.invoke;
		let changed = false;
		const laterCalls: string[] = [];
		fixture.runtime.driver = {
			...fixture.runtime.driver,
			invoke: async (invocation) => {
				if (changed) {
					laterCalls.push(invocation.prompt);
					return { text: 'Capacity unavailable after invalid assessment', exitCode: 1, rateLimited: true };
				}
				const output = await invoke(invocation);
				const response = PlanningRoleResult.parse(JSON.parse(output.text));
				if (response.kind !== 'terminal' || !response.workId.startsWith('assurance:') || !('unknownAssessments' in response)) return output;
				changed = true;
				if (variant === 'omitted') response.unknownAssessments = undefined;
				else {
					const assessment = response.unknownAssessments?.[0];
					if (!assessment) throw new Error('Expected the actual unknown assessment');
					if (variant === 'dependency') assessment.dependencyIds.push('unassigned-dependency');
					if (variant === 'claim') assessment.claimIds.push('nonexistent-claim');
					if (variant.startsWith('acquired')) {
						assessment.outcome = PlanningVocabulary.UnknownAssessment.Acquired;
						assessment.paths = ['linked-handler.ts'];
						const current = await readPlanningSnapshot(fixture);
						const unknown = current?.record.evidence.find((item) => item.dependencyReach === PlanningVocabulary.DependencyReach.Unknown);
						if (!unknown) throw new Error('Expected actual unknown evidence');
						assessment.evidenceIds = [variant === 'acquired-unknown' ? unknown.id : 'missing-evidence'];
					}
				}
				return { ...output, text: JSON.stringify(response) };
			},
		};
		const result = await runPlanning({ runtime: fixture.runtime });
		const snapshot = await readPlanningSnapshot(fixture);
		expect(result.status).toBe('externally-blocked');
		expect(changed).toBe(true);
		expect(laterCalls).toHaveLength(1);
		expect(
			snapshot?.record.findings.some((finding) => /explicit assessment|unassigned dependency or claim|independently observed evidence/.test(finding.scenario)),
		).toBe(true);
		expect(snapshot?.record.work.filter((work) => work.id.startsWith('assurance:')).every((work) => work.resultReceiptId === undefined)).toBe(true);
		expect(snapshot?.record.reviewReceipts.some((receipt) => receipt.workId.startsWith('assurance:'))).toBe(false);
		expect(snapshot?.record.claims.find((claim) => claim.id === 'required')).toStrictEqual(fixture.input.claims[0]);
	},
);

test('accepts required acquired information only after the engine observes its supporting bytes', async () => {
	const fixture = await planningUnknownWorkflowFixture();
	const invoke = fixture.runtime.driver.invoke;
	let requested = false;
	const requestedWorkIds = new Set<string>();
	let acquiredId: string | undefined;
	fixture.runtime.driver = {
		...fixture.runtime.driver,
		invoke: async (invocation) => {
			const output = await invoke(invocation);
			const response = PlanningRoleResult.parse(JSON.parse(output.text));
			if (response.kind !== 'terminal' || !response.workId.startsWith('assurance:') || !('unknownAssessments' in response)) return output;
			if (!requestedWorkIds.has(response.workId)) {
				requestedWorkIds.add(response.workId);
				requested = true;
				const { role, workId, attemptId, inputDigest, invocationId, packetDigest } = response;
				return {
					text: JSON.stringify({
						kind: 'evidence-request',
						role,
						workId,
						attemptId,
						inputDigest,
						invocationId,
						packetDigest,
						requests: [{ requestId: 'actual-target', operation: 'read-file', path: 'target.ts', reason: 'Inspect the underlying required adapter' }],
					}),
					exitCode: 0,
				};
			}
			const packet = JSON.parse(invocation.prompt).context;
			const observed = packet.evidence.find((entry: { evidence: { dependencyReach: string } }) => entry.evidence.dependencyReach === 'known');
			if (!observed) throw new Error('Expected engine-acquired target bytes');
			acquiredId = observed.evidence.id;
			const assessment = response.unknownAssessments?.[0];
			if (!assessment) throw new Error('Expected actual assessment');
			assessment.outcome = PlanningVocabulary.UnknownAssessment.Acquired;
			assessment.evidenceIds = [observed.evidence.id];
			assessment.paths = ['target.ts'];
			return { ...output, text: JSON.stringify(response) };
		},
	};
	const question = await runPlanning({ runtime: fixture.runtime });
	if (question.status !== 'awaiting-user') throw new Error(`Expected explicit approval after acquisition: ${JSON.stringify(question)}`);
	const result = await answerPlanningQuestion({
		runtime: fixture.runtime,
		answer: planningQuestionAnswer({ result: question, delegation: fixture.scope, alignment: true }),
	});
	const snapshot = await readPlanningSnapshot(fixture);
	expect(result.status).toBe('aligned');
	expect(requested).toBe(true);
	expect(snapshot?.record.evidence.find((evidence) => evidence.id === acquiredId)).toEqual(
		expect.objectContaining({ complete: true, dependencyReach: 'known' }),
	);
	const reports = [...(snapshot?.artifacts ?? [])].filter(([path]) => path.startsWith('planning-assurances/')).map(([, text]) => JSON.parse(text));
	expect(
		reports.some((report) =>
			report.assessments.some(
				(assessment: { outcome: string; evidenceIds: string[] }) =>
					assessment.outcome === 'required-acquired' && assessment.evidenceIds.includes(acquiredId ?? ''),
			),
		),
	).toBe(true);
});

test('refreshes unknown assurance from design to implementation review after detailed drafting changes its basis', async () => {
	const fixture = await planningUnknownWorkflowFixture({ stage: PlanningVocabulary.Stage.Implementation });
	const result = await runPlanning({ runtime: fixture.runtime });
	const snapshot = await readPlanningSnapshot(fixture);
	expect(result.status).toBe('complete');
	const roles = snapshot?.record.work.filter((work) => work.id.startsWith('assurance:')).map((work) => work.role);
	expect(roles).toContain('design-review');
	expect(roles).toContain('implementation-review');
	expect(snapshot?.record.work.filter((work) => work.id.startsWith('assurance:')).every((work) => work.status === 'complete')).toBe(true);
	expect(snapshot?.record.reviewReceipts.some((receipt) => receipt.role === 'integration-review')).toBe(true);
});
