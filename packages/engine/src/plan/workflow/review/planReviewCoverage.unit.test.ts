import { beforeAll, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningFinding, type PlanningScope, type PlanningWork, PlanningVocabulary as V } from '#src/contracts/index.ts';
import { type PlanningSnapshot, planReviewCoverage } from '#src/plan/index.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

let completed: PlanningSnapshot;
beforeAll(async () => {
	const fixture = await planningReviewFixture();
	expect((await fixture.run()).status).toBe(V.Status.Complete);
	completed = await fixture.current();
}, 60_000);

/** Unreviewed layout changes are scheduling inputs, never accepted readiness proofs. */
const changedLayout = (prerequisites: Record<string, string[] | undefined> = { B: ['A'] }): PlanningSnapshot => {
	const snapshot = { ...structuredClone(completed), artifacts: new Map(completed.artifacts) };
	const single = snapshot.record.artifacts.find((artifact) => artifact.variant === V.Artifact.Single);
	if (!single) throw new Error('Expected actual completed single-plan history');
	snapshot.record.artifacts = snapshot.record.artifacts.filter((artifact) => artifact.path !== single.path);
	snapshot.artifacts.delete(single.path);
	for (const phaseId of ['A', 'B', 'C']) {
		const path = `phase-${phaseId}.md`;
		const content = `# Unreviewed phase ${phaseId}\n`;
		snapshot.record.artifacts.push({
			...single,
			path,
			phaseId,
			variant: V.Artifact.Phase,
			sha256: sha256({ content }),
			claimIds: phaseId === 'A' ? snapshot.record.claims.map((claim) => claim.id) : [],
			prerequisiteIds: prerequisites[phaseId] ?? [],
		});
		snapshot.artifacts.set(path, content);
	}
	return snapshot;
};
const implementation = (snapshot: PlanningSnapshot) => planReviewCoverage({ snapshot }).filter((work) => work.role === V.Role.ImplementationReview);
const whole: PlanningScope = { kind: V.Scope.WholePlan, phaseIds: [], claimIds: [], packageRoots: [] };
const pending = (snapshot: PlanningSnapshot, scope: PlanningScope, status: PlanningWork['status'] = V.WorkState.Pending): PlanningSnapshot => ({
	...snapshot,
	record: {
		...snapshot.record,
		work: [
			...snapshot.record.work,
			{
				id: 'pending-independent-review',
				role: V.Role.ImplementationReview,
				stage: V.Stage.Implementation,
				scope,
				assignment: 'Inspect the changed connected obligations.',
				inputDigest: sha256({ content: 'pending' }),
				prerequisiteIds: [],
				status,
				attemptSequence: 0,
				failureIds: [],
				diagnosisIds: [],
			},
		],
	},
});

test('reviews connected prerequisite phases while leaving independent islands for their own review', () => {
	for (const prerequisites of [{ B: ['A'] }, { A: ['B'] }, { B: ['A'], C: ['B'] }]) {
		const snapshot = changedLayout(prerequisites);
		const reviews = implementation(snapshot);
		expect(reviews).toHaveLength(1);
		expect(reviews[0].scope).toMatchObject({ kind: V.Scope.Selected, phaseIds: prerequisites.C ? ['A', 'B', 'C'] : ['A', 'B'] });
		expect(reviews[0].scope.claimIds).toEqual(expect.arrayContaining(snapshot.record.claims.map((claim) => claim.id)));
		expect(reviews[0].status).toBe(V.WorkState.Pending);
	}
});

test('widens coverage across explicit shared contracts and falls back to the whole plan for unmapped obligations', () => {
	for (const scope of [{ ...whole, kind: V.Scope.Selected, phaseIds: ['A', 'C'] }, whole]) {
		const snapshot = changedLayout({});
		const source = snapshot.record.claims[0];
		snapshot.record.claims.push({
			...source,
			id: 'shared-retry-interface',
			kind: V.ClaimKind.Contract,
			scope,
			owner: V.Owner.Planner,
			contract: {
				signatures: ['retryUpload(id): Completion'],
				ordering: ['Read completion before retry'],
				failures: ['Preserve completion'],
				boundaries: ['Share stable retry identity'],
			},
		});
		snapshot.record.artifacts.find((artifact) => artifact.phaseId === 'A')?.claimIds.push('shared-retry-interface');
		expect(implementation(snapshot)[0].scope).toMatchObject({
			kind: V.Scope.Selected,
			phaseIds: scope.kind === V.Scope.WholePlan ? ['A', 'B', 'C'] : ['A', 'C'],
		});
	}
	const orphan = changedLayout();
	for (const artifact of orphan.record.artifacts) artifact.claimIds = [];
	expect(implementation(orphan)[0].scope.kind).toBe(V.Scope.WholePlan);
	const overview = changedLayout({});
	const first = overview.record.artifacts.find((artifact) => artifact.phaseId === 'A');
	if (!first) throw new Error('Expected first unreviewed artifact');
	first.variant = V.Artifact.Overview;
	first.phaseId = undefined;
	expect(implementation(overview)[0].scope.kind).toBe(V.Scope.WholePlan);
});

test('deduplicates only live pending work that actually covers the requested scope', () => {
	const snapshot = changedLayout();
	const scope = implementation(snapshot)[0].scope;
	expect(implementation(pending(snapshot, scope))).toHaveLength(0);
	expect(implementation(pending(snapshot, whole))).toHaveLength(0);
	expect(implementation(pending(snapshot, { ...scope, phaseIds: ['A'] }))).toHaveLength(1);
	expect(implementation(pending(snapshot, { ...scope, claimIds: [], phaseIds: [] }))).toHaveLength(1);
	expect(implementation(pending(snapshot, scope, V.WorkState.Interrupted))).toHaveLength(1);
	const orphan = changedLayout();
	for (const artifact of orphan.record.artifacts) artifact.claimIds = [];
	expect(implementation(pending(orphan, scope))).toHaveLength(1);
	const alreadyScheduled = implementation(snapshot)[0];
	expect(
		implementation({ ...snapshot, record: { ...snapshot.record, work: [...snapshot.record.work, { ...alreadyScheduled, status: V.WorkState.Interrupted }] } }),
	).toHaveLength(0);
});

test('requires accepted authoring before detailed review and a distinct final integration review', () => {
	expect(planReviewCoverage({ snapshot: completed })).toEqual([]);
	const noAuthor = changedLayout();
	noAuthor.record.work = noAuthor.record.work.filter((work) => work.role !== V.Role.Architect);
	expect(planReviewCoverage({ snapshot: noAuthor })).toEqual([]);
	expect(planReviewCoverage({ snapshot: { ...noAuthor, record: { ...noAuthor.record, work: [] } } })).toEqual([]);
	const noDraft = changedLayout();
	noDraft.record.work = noDraft.record.work.filter((work) => work.role !== V.Role.Draft);
	expect(implementation(noDraft)).toEqual([]);
	const missingIntegration = structuredClone(completed);
	missingIntegration.record.reviewReceipts = missingIntegration.record.reviewReceipts.filter((receipt) => receipt.role !== V.Role.IntegrationReview);
	missingIntegration.record.work = missingIntegration.record.work.filter((work) => work.role !== V.Role.IntegrationReview);
	expect(planReviewCoverage({ snapshot: missingIntegration }).map((work) => work.role)).toEqual([V.Role.IntegrationReview]);
});

const finding = (snapshot: PlanningSnapshot): PlanningFinding => ({
	id: 'unresolved-retry',
	observationIds: ['observed-retry'],
	scope: whole,
	scenario: 'Retry fails after completion.',
	consequence: 'Completed uploads could be deleted.',
	missingObligation: 'Preserve completion on failure.',
	severity: V.Severity.Blocking,
	owner: V.Owner.Planner,
	state: V.FindingState.Open,
	resolutionClaimIds: [],
	resolutionArtifacts: [],
	verificationReceiptIds: [],
	citations: [
		{
			artifact: `planning-originals/${snapshot.record.sources[0].sha256}.txt`,
			sha256: snapshot.record.sources[0].sha256,
			quote: snapshot.record.sources[0].text,
		},
	],
});

test('repairs concrete semantic gaps while leaving operational failures to their owned recovery', () => {
	const snapshot = structuredClone(completed);
	const defect = finding(snapshot);
	snapshot.record.findings.push(defect);
	expect(planReviewCoverage({ snapshot }).filter((work) => work.role === V.Role.Repair)).toHaveLength(1);
	snapshot.record.work[0].failureIds.push(defect.id);
	expect(planReviewCoverage({ snapshot }).filter((work) => work.role === V.Role.Repair)).toHaveLength(0);
	snapshot.record.work[0].failureIds = [];
	for (const role of [V.Role.Repair, V.Role.Adjudicate]) {
		const resolving = structuredClone(snapshot);
		resolving.record.work.push({ ...resolving.record.work[0], id: `resolving-${role}`, role, status: V.WorkState.Pending });
		expect(planReviewCoverage({ snapshot: resolving }).filter((work) => work.role === V.Role.Repair)).toHaveLength(0);
	}
	defect.owner = V.Owner.User;
	expect(planReviewCoverage({ snapshot }).filter((work) => work.role === V.Role.Repair)).toHaveLength(0);
});

test('keeps brainstorming coverage focused on product design before asking for alignment', async () => {
	const fixture = await planningReviewFixture({ stage: V.Stage.Brainstorm });
	expect((await fixture.run()).status).toBe(V.Status.AwaitingUser);
	const snapshot = await fixture.current();
	snapshot.record.reviewReceipts = [];
	snapshot.record.work = snapshot.record.work.filter((work) => work.role !== V.Role.DesignReview);
	expect(planReviewCoverage({ snapshot }).map((work) => work.role)).toEqual([V.Role.DesignReview]);
}, 60_000);
