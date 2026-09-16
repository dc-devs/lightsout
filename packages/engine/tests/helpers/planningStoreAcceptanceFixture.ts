import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningArtifact, type PlanningRecord, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import { commitPlanningSnapshot, PlanningMode, type PlanningRuntime, type PlanningSnapshot } from '#src/plan/index.ts';

export const directories: string[] = [];
export const scope = { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] };
export const artifact = ({ path, text }: { path: string; text: string }): PlanningArtifact => ({
	path,
	variant: path.endsWith('.md') ? PlanningVocabulary.Artifact.Single : PlanningVocabulary.Artifact.Data,
	sha256: sha256({ content: text }),
	claimIds: [],
	prerequisiteIds: [],
	exports: [],
	boundaries: scope,
});
export const work = (): PlanningWork => ({
	id: 'investigate',
	role: PlanningVocabulary.Role.Investigate,
	stage: PlanningVocabulary.Stage.Implementation,
	scope,
	prerequisiteIds: [],
	inputDigest: sha256({ content: 'retry contract' }),
	status: PlanningVocabulary.WorkState.Pending,
	attemptSequence: 0,
	failureIds: [],
	diagnosisIds: [],
	assignment: 'Verify retry identities',
});
export const setup = async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'planning-store-'));
	directories.push(cwd);
	const name = 'retry-upload';
	const record: PlanningRecord = {
		schemaVersion: 1,
		planName: name,
		revision: 0,
		parentDigest: null,
		sources: [],
		claims: [],
		evidence: [],
		work: [work()],
		findings: [],
		reviewReceipts: [],
		artifacts: [artifact({ path: 'plan.md', text: 'Original plan' })],
		confirmations: [],
		standards: [],
	};
	const artifacts = new Map([['plan.md', 'Original plan']]);
	let now = 0;
	let calls = 0;
	const leases = new Map<string, { expiresAt: number; fenced: boolean }>();
	const unused = () => {
		throw new Error('Storage must not execute role services');
	};
	const runtime: PlanningRuntime = {
		cwd,
		name,
		config: { gates: { check: 'true', test: 'true', 'test-coverage': false } },
		standards: 'Preserve retry identity',
		mode: PlanningMode.Automatic,
		stage: PlanningVocabulary.Stage.Implementation,
		driver: {
			name: 'test',
			invoke: async () => {
				calls++;
				return { text: 'Saved investigation result', exitCode: 0 };
			},
		},
		services: { draft: unused, validate: unused, invalidate: unused, evaluate: unused, integration: unused },
		lease: {
			create: async ({ attemptId }) => {
				leases.set(attemptId, { expiresAt: now + 10, fenced: false });
			},
			renew: async ({ attemptId }) => {
				const lease = leases.get(attemptId);
				if (lease === undefined || lease.fenced || lease.expiresAt <= now) throw new Error('Attempt lease is no longer live');
				lease.expiresAt = now + 10;
			},
			fenceExpired: async ({ attemptId }) => {
				const lease = leases.get(attemptId);
				if (lease === undefined) throw new Error('Missing lease');
				if (!lease.fenced && lease.expiresAt > now) return false;
				lease.fenced = true;
				return true;
			},
		},
	};
	const first = await commitPlanningSnapshot({ cwd, name, expectedRevision: -1, parentDigest: null, record, artifacts });
	if (!first.committed) throw new Error('Unexpected competing setup');
	return {
		cwd,
		name,
		record,
		artifacts,
		runtime,
		snapshot: first.snapshot,
		advance: () => {
			now += 20;
		},
		calls: () => calls,
	};
};
export const candidate = ({ snapshot, text }: { snapshot: PlanningSnapshot; text: string }) => {
	const artifacts = new Map(snapshot.artifacts);
	artifacts.set('plan.md', text);
	return {
		expectedRevision: snapshot.record.revision,
		parentDigest: snapshot.digest,
		record: {
			...snapshot.record,
			revision: snapshot.record.revision + 1,
			parentDigest: snapshot.digest,
			artifacts: snapshot.record.artifacts.map((item) => (item.path === 'plan.md' ? artifact({ path: 'plan.md', text }) : item)),
		},
		artifacts,
	};
};
export const completed = ({ snapshot, attemptId, text }: { snapshot: PlanningSnapshot; attemptId: string; text: string }) => {
	const receiptId = `result:${attemptId}`;
	const receiptPath = `planning-results/${sha256({ content: receiptId })}.json`;
	const result = candidate({ snapshot, text });
	const receiptText = canonicalJson({
		value: {
			id: receiptId,
			workId: 'investigate',
			attemptId,
			role: PlanningVocabulary.Role.Investigate,
			inputDigest: work().inputDigest,
			resultDigest: sha256({ content: text }),
			acceptedFromDigest: snapshot.digest,
			acceptedRevision: snapshot.record.revision + 1,
			effects: { claimIds: [], evidenceIds: [], findingIds: [], reviewReceiptIds: [], artifacts: [{ path: 'plan.md', sha256: sha256({ content: text }) }] },
		},
	});
	result.artifacts.set(receiptPath, receiptText);
	result.record.artifacts.push(artifact({ path: receiptPath, text: receiptText }));
	result.record.work = result.record.work.map((item) => ({
		...item,
		status: PlanningVocabulary.WorkState.Complete,
		currentAttemptId: attemptId,
		resultReceiptId: receiptId,
	}));
	return result;
};

export const setupGraph = async ({ variant }: { variant: string }) => {
	const context = await setup();
	const text = 'Retry identities are stable';
	const origin = { artifact: 'notes.md', locator: 'Retry', text, sha256: sha256({ content: text }) };
	const claim = {
		id: 'c1',
		kind: PlanningVocabulary.ClaimKind.Architecture,
		text,
		explanation: 'Idempotency',
		origin,
		owner: PlanningVocabulary.Owner.Planner,
		state: PlanningVocabulary.ClaimState.Settled,
		contentRevision: 1,
		dependencies: ['c2'],
		scope,
	};
	const record: PlanningRecord = { ...context.record, sources: [origin], claims: [claim, { ...claim, id: 'c2', dependencies: ['c1'] }] };
	if (variant === 'duplicate') record.claims.push(claim);
	if (variant === 'dangling') record.claims[0].dependencies = ['missing'];
	if (variant === 'superseded') record.claims[0].state = PlanningVocabulary.ClaimState.Superseded;
	if (variant === 'execution-cycle') record.work[0].prerequisiteIds = ['investigate'];
	return { record, valid: variant === 'semantic-cycle' };
};
