import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningRecord, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import type { PlanningRuntime, PlanningSnapshot } from '#src/plan/index.ts';
import { claimPlanningAttempt, commitPlanningSnapshot, PlanningLease, PlanningMode, type PlanningResultReceipt } from '#src/plan/index.ts';
import { planningStoreFixture } from './planningStoreFixture.ts';

/** A real claimed investigation and an independently claimed reviewer, with immutable accepted receipts. */
export const planningCompletedFixture = async () => {
	const fixture = await planningStoreFixture();
	const { cwd, name, scope, origin, record } = fixture;
	const unused = () => {
		throw new Error('Receipt tests must not invoke a provider or role service');
	};
	const runtime: PlanningRuntime = {
		cwd,
		name,
		config: { gates: { check: 'true', test: 'true', 'test-coverage': false } },
		standards: '',
		mode: PlanningMode.Automatic,
		stage: PlanningVocabulary.Stage.Implementation,
		driver: { name: 'uncalled', invoke: unused },
		services: { draft: unused, validate: unused, invalidate: unused, evaluate: unused, integration: unused },
		lease: new PlanningLease({ cwd, name }),
	};
	const author: PlanningWork = {
		id: 'author',
		role: PlanningVocabulary.Role.Investigate,
		stage: PlanningVocabulary.Stage.Implementation,
		scope,
		prerequisiteIds: [],
		inputDigest: origin.sha256,
		status: PlanningVocabulary.WorkState.Pending,
		attemptSequence: 0,
		failureIds: [],
		diagnosisIds: [],
		assignment: 'Investigate idempotency',
	};
	record.work = [
		author,
		{ ...author, id: 'reviewer', role: PlanningVocabulary.Role.ImplementationReview, prerequisiteIds: ['author'], assignment: 'Review idempotency' },
	];
	await commitPlanningSnapshot({ ...fixture, expectedRevision: -1, parentDigest: null });
	const claim = await claimPlanningAttempt({ runtime, workId: 'author', expectedInputDigest: origin.sha256 });
	if (!claim.claimed) throw new Error('Author claim failed');
	const investigated = structuredClone(claim.snapshot.record);
	investigated.claims.push({
		...record.claims[0],
		id: 'technical',
		owner: PlanningVocabulary.Owner.Planner,
		confirmationId: undefined,
		text: 'Use an idempotency key',
	});
	investigated.evidence.push({
		id: 'evidence',
		assignmentId: 'author',
		claimIds: ['technical'],
		dependencies: [],
		conclusion: 'Existing key is stable',
		uncertaintyIds: [],
		complete: true,
		acquisition: 'read-file',
		dependencyReach: PlanningVocabulary.DependencyReach.Known,
		sourceIds: ['notes.md'],
		configDigest: origin.sha256,
		standardsDigest: origin.sha256,
	});
	const citation = { artifact: 'plan.md', quote: fixture.text, sha256: origin.sha256 };
	investigated.findings.push({
		id: 'finding',
		observationIds: ['original', 'repeated'],
		scope,
		scenario: 'Retry duplicates a write',
		consequence: 'Duplicate records',
		missingObligation: 'Preserve identity',
		severity: PlanningVocabulary.Severity.Blocking,
		owner: PlanningVocabulary.Owner.Planner,
		state: PlanningVocabulary.FindingState.Open,
		resolutionClaimIds: [],
		resolutionArtifacts: [],
		verificationReceiptIds: [],
		citations: [citation],
	});
	const firstCandidate = planningCompletionCandidate({
		snapshot: claim.snapshot,
		record: investigated,
		workId: 'author',
		effects: { claimIds: ['technical'], evidenceIds: ['evidence'], findingIds: ['finding'], reviewReceiptIds: [], artifacts: [] },
	});
	await commitPlanningSnapshot({ cwd, name, ...firstCandidate });
	const reviewing = await claimPlanningAttempt({ runtime, workId: 'reviewer', expectedInputDigest: origin.sha256 });
	if (!reviewing.claimed) throw new Error('Reviewer claim failed');
	const reviewed = structuredClone(reviewing.snapshot.record);
	reviewed.reviewReceipts.push({
		id: 'review',
		workId: 'reviewer',
		attemptId: reviewing.attemptId,
		authorAttemptIds: [claim.attemptId],
		role: PlanningVocabulary.Role.ImplementationReview,
		inputDigest: origin.sha256,
		coverage: { claimIds: ['required', 'technical'], phaseIds: [], adequacy: 'Checked retry failure scenario', outcome: PlanningVocabulary.Review.Adequate },
		dependencies: [],
		issuer: { agent: 'independent', invocationId: 'invocation-review' },
		findingIds: ['finding'],
		verifiedFindings: [{ findingId: 'finding', citations: [citation] }],
		completedAt: '2026-09-14T00:00:00.000Z',
	});
	reviewed.findings[0] = {
		...reviewed.findings[0],
		state: PlanningVocabulary.FindingState.Verified,
		resolutionClaimIds: ['technical'],
		resolutionArtifacts: ['plan.md'],
		verificationReceiptIds: ['review'],
	};
	const candidate = planningCompletionCandidate({
		snapshot: reviewing.snapshot,
		record: reviewed,
		workId: 'reviewer',
		effects: { claimIds: [], evidenceIds: [], findingIds: ['finding'], reviewReceiptIds: ['review'], artifacts: [{ path: 'plan.md', sha256: origin.sha256 }] },
	});
	return { ...fixture, runtime, reviewing: reviewing.snapshot, candidate };
};

/** Build exact accepted-result provenance; the production commit performs every authority check. */
export const planningCompletionCandidate = ({
	snapshot,
	record,
	workId,
	effects,
}: {
	snapshot: PlanningSnapshot;
	record: PlanningRecord;
	workId: string;
	effects: PlanningResultReceipt['effects'];
}) => {
	const work = record.work.find((item) => item.id === workId);
	if (work?.currentAttemptId === undefined) throw new Error('Completion requires a claimed attempt');
	const receipt: PlanningResultReceipt = {
		id: `result:${work.currentAttemptId}`,
		workId,
		attemptId: work.currentAttemptId,
		role: work.role,
		inputDigest: work.inputDigest,
		resultDigest: sha256({ content: 'role output' }),
		acceptedFromDigest: snapshot.digest,
		acceptedRevision: snapshot.record.revision + 1,
		effects,
	};
	const content = canonicalJson({ value: receipt });
	const path = `planning-results/${sha256({ content: receipt.id })}.json`;
	const artifacts = new Map(snapshot.artifacts);
	artifacts.set(path, content);
	record.revision = snapshot.record.revision + 1;
	record.parentDigest = snapshot.digest;
	record.artifacts.push({
		path,
		variant: PlanningVocabulary.Artifact.Data,
		sha256: sha256({ content }),
		claimIds: [],
		prerequisiteIds: [],
		exports: [],
		boundaries: work.scope,
	});
	work.status = PlanningVocabulary.WorkState.Complete;
	work.resultReceiptId = receipt.id;
	return { record, artifacts, receipt, path, expectedRevision: snapshot.record.revision, parentDigest: snapshot.digest };
};
