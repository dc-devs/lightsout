import { expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningFinding, PlanningVocabulary } from '#src/contracts/index.ts';
import {
	answerPlanningQuestion,
	capturePlanningInput,
	commitPlanningSnapshot,
	createPlanningGrade,
	evaluatePlanningReadiness,
	invalidatePlanningEvidence,
	type PlanningSnapshot,
} from '#src/plan/index.ts';
import { planningDraftHistoryFixture } from '#tests/helpers/planningDraftHistoryFixture.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

const readiness = (
	snapshot: PlanningSnapshot,
	stage: (typeof PlanningVocabulary.Stage)[keyof typeof PlanningVocabulary.Stage] = PlanningVocabulary.Stage.Implementation,
) => evaluatePlanningReadiness({ snapshot, stage, structural: [], dependenciesCurrent: true });

const defect = ({ snapshot, id = 'missing-error-contract' }: { snapshot: PlanningSnapshot; id?: string }): PlanningFinding => {
	const artifact = snapshot.record.artifacts.find(
		(item) => item.variant !== PlanningVocabulary.Artifact.Data && item.variant !== PlanningVocabulary.Artifact.Overview,
	);
	if (!artifact) throw new Error('A concrete defect needs the actual implementation artifact');
	return {
		id,
		observationIds: [`${id}:observation`],
		scope: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
		scenario: 'Retry fails after completion',
		consequence: 'Completed uploads could be deleted.',
		missingObligation: 'Preserve completion on every failed retry and retain ownership.',
		severity: PlanningVocabulary.Severity.Blocking,
		owner: PlanningVocabulary.Owner.Planner,
		state: PlanningVocabulary.FindingState.Open,
		resolutionClaimIds: [],
		resolutionArtifacts: [],
		verificationReceiptIds: [],
		citations: [{ artifact: artifact.path, sha256: artifact.sha256, quote: snapshot.artifacts.get(artifact.path)?.split('\n')[0] ?? '' }],
	};
};

test('blocks planner-owned defects and absent independent coverage', async () => {
	const fixture = await planningReviewFixture();
	expect((await fixture.run()).status).toBe(PlanningVocabulary.Status.Complete);
	const snapshot = await fixture.current();
	expect(readiness(snapshot).ready).toBe(true);
	const finding = defect({ snapshot });
	expect(readiness({ ...snapshot, record: { ...snapshot.record, findings: [...snapshot.record.findings, finding] } })).toMatchObject({
		ready: false,
		openBlockerIds: expect.arrayContaining([finding.id]),
	});
	const missing = new Map(snapshot.artifacts);
	for (const artifact of snapshot.record.artifacts.filter((item) => item.path.startsWith('planning-results/'))) missing.delete(artifact.path);
	expect(readiness({ ...snapshot, artifacts: missing }).ready).toBe(false);
	const selfReview = structuredClone(snapshot.record);
	for (const receipt of selfReview.reviewReceipts) receipt.authorAttemptIds.push(receipt.attemptId);
	expect(readiness({ ...snapshot, record: selfReview }).ready).toBe(false);
	expect(snapshot.record.artifacts.filter((item) => item.variant === PlanningVocabulary.Artifact.Single)).toHaveLength(1);
}, 60_000);

test('reuses unaffected reviews and widens uncertain changes', async () => {
	const fixture = await planningDraftHistoryFixture();
	const snapshot = fixture.snapshot;
	const a = snapshot.record.reviewReceipts.find((receipt) => receipt.workId === 'verify-a');
	const c = snapshot.record.reviewReceipts.find((receipt) => receipt.workId === 'review-c');
	if (!a || !c) throw new Error('The history fixture must establish both actual independent receipts');
	const local = invalidatePlanningEvidence({ snapshot, changedDependencies: [], changedClaimIds: ['retry-choice'] });
	expect(local.receiptIds).toContain(a.id);
	expect(local.receiptIds).not.toContain(c.id);
	expect(local.workIds).not.toContain('author-c');
	const global = invalidatePlanningEvidence({ snapshot, changedDependencies: [], changedClaimIds: ['required'] });
	expect(global.receiptIds).toEqual(expect.arrayContaining([a.id, c.id]));
	const unknown = invalidatePlanningEvidence({
		snapshot,
		changedClaimIds: [],
		changedDependencies: [
			{
				id: 'unknown-reach',
				kind: PlanningVocabulary.Dependency.Unknown,
				roots: ['.'],
				reason: 'A tool read could not be observed.',
				fallbackFingerprint: sha256({ content: 'new reach' }),
			},
		],
	});
	expect(unknown.receiptIds).toEqual(expect.arrayContaining([a.id, c.id]));
	const search = invalidatePlanningEvidence({
		snapshot,
		changedClaimIds: [],
		changedDependencies: [
			{
				id: 'new-callers',
				kind: PlanningVocabulary.Dependency.Search,
				roots: ['src'],
				query: 'retryUpload',
				options: { regex: false, caseSensitive: true, glob: '**/*.ts', exclude: [] },
				universeFingerprint: sha256({ content: 'new caller' }),
				resultFingerprint: sha256({ content: 'changed matches' }),
			},
		],
	});
	expect(search.receiptIds).toEqual(expect.arrayContaining([a.id, c.id]));
	const standards = invalidatePlanningEvidence({
		snapshot,
		changedClaimIds: [],
		changedDependencies: [
			{
				id: 'configured-code-standards',
				kind: PlanningVocabulary.Dependency.Content,
				path: 'planning-standards.json',
				sha256: sha256({ content: 'changed required standards' }),
			},
		],
	});
	expect(standards.receiptIds).toEqual(expect.arrayContaining([a.id, c.id]));
	expect(invalidatePlanningEvidence({ snapshot, changedDependencies: [], changedClaimIds: [] })).toMatchObject({ workIds: [], receiptIds: [] });
}, 60_000);

test('judges only disputed findings and preserves all observations', async () => {
	for (const disputed of [false, true]) {
		let discovered = false;
		const fixture = await planningReviewFixture({
			respond: ({ response, snapshot }) => {
				if (!discovered && response.role === PlanningVocabulary.Role.ImplementationReview && 'coverage' in response) {
					discovered = true;
					const first = defect({ snapshot, id: 'error-path' });
					const second = {
						...defect({ snapshot, id: 'concurrent-retry' }),
						scenario: 'A second retry races the failed retry.',
						observationIds: ['concurrent-retry-observation'],
					};
					return {
						...response,
						findings: [first, second],
						...(disputed
							? {
									adjudicationRequests: [
										{
											findingIds: [first.id, second.id],
											reason: PlanningVocabulary.Dispute.ConflictingReports,
											explanation: 'Resolve whether the same preservation requirement applies to both observed paths.',
											citations: first.citations,
										},
									],
								}
							: {}),
					};
				}
				return response;
			},
		});
		expect((await fixture.run()).status).toBe(PlanningVocabulary.Status.Complete);
		const snapshot = await fixture.current();
		const observations = snapshot.record.findings.filter(
			(finding) => finding.scenario === 'Retry fails after completion' || finding.scenario === 'A second retry races the failed retry.',
		);
		expect(observations).toHaveLength(2);
		expect(new Set(observations.flatMap((finding) => finding.observationIds)).size).toBe(2);
		expect(observations.every((finding) => finding.state === PlanningVocabulary.FindingState.Verified && finding.verificationReceiptIds.length > 0)).toBe(true);
		const partial = structuredClone(snapshot.record);
		const second = partial.findings.find((finding) => finding.id === observations[1].id);
		if (!second) throw new Error('The second observation must remain independently addressable');
		second.state = PlanningVocabulary.FindingState.Repairing;
		second.verificationReceiptIds = [];
		expect(readiness({ ...snapshot, record: partial })).toMatchObject({ ready: false, openBlockerIds: expect.arrayContaining([second.id]) });
		const adjudications = snapshot.record.work.filter((work) => work.role === PlanningVocabulary.Role.Adjudicate);
		expect(adjudications).toHaveLength(disputed ? 1 : 0);
		const reviewers = snapshot.record.work.filter((work) => work.role === PlanningVocabulary.Role.ImplementationReview);
		expect(reviewers).toHaveLength(1);
		expect(reviewers[0].attemptSequence).toBe(2);
		const actualReviews = snapshot.record.reviewReceipts.filter((receipt) => receipt.workId === reviewers[0].id);
		expect(new Set(actualReviews.map((receipt) => receipt.attemptId)).size).toBe(2);
		expect(observations.every((finding) => finding.verificationReceiptIds.includes(actualReviews[1].id))).toBe(true);
	}
}, 60_000);

test('requires fresh independent integration against original intent', async () => {
	const sourceText = 'Preserve completed uploads. Never expose credentials in retry failures.';
	let firstIntegration = true;
	const fixture = await planningReviewFixture({
		sourceText,
		respond: ({ response }) => {
			if (firstIntegration && response.role === PlanningVocabulary.Role.IntegrationReview && 'coverage' in response) {
				firstIntegration = false;
				return { ...response, coverage: { ...response.coverage, artifactPaths: [] } };
			}
			return response;
		},
	});
	expect((await fixture.run()).status).toBe(PlanningVocabulary.Status.Complete);
	const complete = await fixture.current();
	expect(complete.record.reviewReceipts.filter((receipt) => receipt.role === PlanningVocabulary.Role.IntegrationReview)).toHaveLength(2);
	const discovered = await fixture.accept({
		role: PlanningVocabulary.Role.IntegrationReview,
		propose: ({ response, snapshot }) => {
			if (!('coverage' in response)) throw new Error('Expected an actual integration response');
			return {
				...response,
				findings: [
					{
						...defect({ snapshot, id: 'omitted-credentials' }),
						scenario: 'An original requirement was absent from concrete failure wiring.',
						consequence: 'Retry failures could disclose credentials.',
						missingObligation: 'Never expose credentials in retry failures.',
					},
				],
			};
		},
	});
	expect(fixture.calls.some((call) => call.prompt.includes('Never expose credentials in retry failures.'))).toBe(true);
	expect(readiness(discovered).ready).toBe(false);
	const grade = createPlanningGrade({ snapshot: discovered, readiness: readiness(discovered), structural: [] });
	expect(grade).toMatchObject({ passed: false, complete: false });
	expect(createPlanningGrade({ snapshot: complete, readiness: readiness(complete), structural: [] })).toMatchObject({
		grade: 'A',
		passed: true,
		complete: true,
		phasesChecked: ['plan.md'],
		lenses: [],
		phasesLight: [],
	});
}, 60_000);

test('does not drop missing persistent findings on regrade', async () => {
	const fixture = await planningReviewFixture();
	expect((await fixture.run()).status).toBe(PlanningVocabulary.Status.Complete);
	const found = await fixture.accept({
		role: PlanningVocabulary.Role.ImplementationReview,
		propose: ({ response, snapshot }) => {
			if (!('coverage' in response)) throw new Error('Expected a concrete implementation review');
			return { ...response, findings: [defect({ snapshot })] };
		},
	});
	const observation = found.record.findings.find((finding) => finding.scenario === 'Retry fails after completion');
	if (!observation) throw new Error('The actual reviewer must have accepted its persistent finding');
	const absent = await fixture.accept({ role: PlanningVocabulary.Role.ImplementationReview });
	expect(absent.record.findings.find((finding) => finding.id === observation.id)).toEqual(observation);
	expect(readiness(absent)).toMatchObject({ ready: false, openBlockerIds: expect.arrayContaining([observation.id]) });
	const missing = new Map(absent.artifacts);
	for (const descriptor of absent.record.artifacts.filter((item) => item.path.startsWith('planning-invocations/'))) missing.set(descriptor.path, '{malformed');
	expect(readiness({ ...absent, artifacts: missing }).ready).toBe(false);
}, 60_000);

test('keeps integration approval stable without ignoring semantic changes', async () => {
	const fixture = await planningReviewFixture();
	expect((await fixture.run()).status).toBe(PlanningVocabulary.Status.Complete);
	const snapshot = await fixture.current();
	const digest = readiness(snapshot).inputDigest;
	const bookkeeping = {
		...snapshot,
		digest: sha256({ content: 'display generation' }),
		record: { ...snapshot.record, revision: snapshot.record.revision + 1 },
	};
	expect(readiness(bookkeeping).inputDigest).toBe(digest);
	expect(readiness(bookkeeping).ready).toBe(true);
	const rereviewed = await fixture.accept({ role: PlanningVocabulary.Role.ImplementationReview });
	expect(readiness(rereviewed).inputDigest).not.toBe(digest);
	expect(readiness(rereviewed).ready).toBe(false);
	const changed = new Map(snapshot.artifacts);
	changed.set('plan.md', `${changed.get('plan.md')}\nUnexpected semantic change.\n`);
	expect(readiness({ ...snapshot, artifacts: changed }).ready).toBe(false);
}, 60_000);

test('dispatches readiness by stage without conflating alignment and completion', async () => {
	let firstChallenge = true;
	const fixture = await planningReviewFixture({
		stage: PlanningVocabulary.Stage.Brainstorm,
		respond: ({ response }) => {
			if (firstChallenge && response.role === PlanningVocabulary.Role.DesignReview && 'coverage' in response) {
				firstChallenge = false;
				return { ...response, coverage: { ...response.coverage, claimIds: response.coverage.claimIds.slice(0, 1) } };
			}
			return response;
		},
	});
	const result = await fixture.run();
	if (result.status !== PlanningVocabulary.Status.AwaitingUser) throw new Error('Brainstorm must ask for explicit current-design alignment');
	expect(result.question.context).toContain('Preserve completed uploads');
	expect((await fixture.current()).record.reviewReceipts.filter((receipt) => receipt.role === PlanningVocabulary.Role.DesignReview).length).toBeGreaterThan(1);
	const selectedOption = result.question.options[0]?.label;
	if (!selectedOption) throw new Error('Alignment must provide an explicit approval option');
	const aligned = await answerPlanningQuestion({
		runtime: fixture.runtime,
		answer: {
			questionId: result.questionId,
			questionDigest: result.questionDigest,
			checkpointRevision: result.checkpointRevision,
			selectedOption,
			confirmation: {
				id: 'notes-approval',
				channel: PlanningVocabulary.ConfirmationChannel.Foreground,
				messageId: 'actual-final-approval',
				messageText: selectedOption,
				approvedDigest: sha256({ content: selectedOption }),
				delegation: fixture.scope,
			},
		},
	});
	expect(aligned).toMatchObject({ status: PlanningVocabulary.Status.Aligned, confirmationId: 'notes-approval' });
	const snapshot = await fixture.current();
	expect(readiness(snapshot, PlanningVocabulary.Stage.Brainstorm)).toMatchObject({ ready: true, target: PlanningVocabulary.Target.Alignment });
	expect(readiness(snapshot).ready).toBe(false);
	expect(createPlanningGrade({ snapshot, readiness: readiness(snapshot, PlanningVocabulary.Stage.Brainstorm), structural: [] })).toMatchObject({
		passed: false,
		complete: false,
	});
	const unrelated = await capturePlanningInput({
		runtime: fixture.runtime,
		input: {
			stage: fixture.runtime.stage,
			sources: [],
			claims: [],
			confirmations: [
				{
					id: 'unrelated-answer',
					channel: PlanningVocabulary.ConfirmationChannel.Foreground,
					messageId: 'later-unrelated-message',
					messageText: 'An unrelated answer',
					approvedDigest: snapshot.record.sources[0].sha256,
					delegation: fixture.scope,
				},
			],
		},
	});
	expect(readiness(unrelated, PlanningVocabulary.Stage.Brainstorm).ready).toBe(true);
}, 60_000);

test('replaces the alignment checkpoint when an unchanged design receives a new challenge', async () => {
	const fixture = await planningReviewFixture({ stage: PlanningVocabulary.Stage.Brainstorm });
	const first = await fixture.run();
	if (first.status !== PlanningVocabulary.Status.AwaitingUser) throw new Error('Expected first challenged-design checkpoint');
	const before = await fixture.current();
	const record = structuredClone(before.record);
	const reviewer = record.work.find((work) => work.role === PlanningVocabulary.Role.DesignReview);
	if (!reviewer) throw new Error('Expected actual original challenge');
	reviewer.status = PlanningVocabulary.WorkState.Pending;
	reviewer.currentAttemptId = undefined;
	reviewer.resultReceiptId = undefined;
	const saved = await commitPlanningSnapshot({
		...fixture,
		expectedRevision: before.record.revision,
		parentDigest: before.digest,
		record: { ...record, revision: record.revision + 1, parentDigest: before.digest },
		artifacts: before.artifacts,
	});
	expect(saved.committed).toBe(true);
	const next = await fixture.run();
	if (next.status !== PlanningVocabulary.Status.AwaitingUser) throw new Error('Expected replacement challenged-design checkpoint');
	expect(next.questionId).toBe(first.questionId);
	expect(next.questionDigest).not.toBe(first.questionDigest);
	const selectedOption = next.question.options[0].label;
	const confirmation = {
		id: 'replacement-alignment',
		channel: PlanningVocabulary.ConfirmationChannel.Foreground,
		messageId: 'replacement-approval',
		messageText: selectedOption,
		approvedDigest: sha256({ content: selectedOption }),
		delegation: fixture.scope,
	};
	await expect(
		answerPlanningQuestion({
			runtime: fixture.runtime,
			answer: {
				questionId: first.questionId,
				questionDigest: first.questionDigest,
				checkpointRevision: first.checkpointRevision,
				selectedOption,
				confirmation,
			},
		}),
	).rejects.toThrow(/current checkpoint/);
	await expect(
		answerPlanningQuestion({
			runtime: fixture.runtime,
			answer: { questionId: next.questionId, questionDigest: next.questionDigest, checkpointRevision: next.checkpointRevision, selectedOption, confirmation },
		}),
	).resolves.toMatchObject({ status: PlanningVocabulary.Status.Aligned, confirmationId: confirmation.id });
}, 60_000);
