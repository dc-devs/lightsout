import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { applyPlanningResult } from '#src/plan/workflow/applyPlanningResult/index.ts';
import { adoptPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/adoptPlanningExecutionPolicy.ts';
import { assertPlanningDispatch } from '#src/plan/workflow/common/policy/assertPlanningDispatch.ts';
import { buildPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/buildPlanningExecutionPolicy.ts';
import { readPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/readPlanningExecutionPolicy.ts';
import { getCurrentPlanningReviews } from '#src/plan/workflow/common/review/getCurrentPlanningReviews.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import { resolvePlanningStandards } from '#src/plan/workflow/context/index.ts';
import { invokePlanningRole } from '#src/plan/workflow/invokePlanningRole.ts';
import { planReviewCoverage } from '#src/plan/workflow/review/index.ts';
import { claimPlanningAttempt, commitPlanningSnapshot, PlanningLease, readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

const setup = async () => {
	const fixture = await planningReviewFixture();
	const snapshot = await fixture.capture();
	const standards = await resolvePlanningStandards({
		cwd: fixture.cwd,
		config: fixture.runtime.config,
		role: PlanningVocabulary.Role.Architect,
		scope: fixture.scope,
	});
	const policy = buildPlanningExecutionPolicy({ runtime: fixture.runtime, standards });
	fixture.runtime.executionPolicy = policy;
	return { ...fixture, snapshot, standards, policy };
};

const setupOwned = async () => {
	const fixture = await setup();
	let now = 0;
	fixture.runtime.lease = new PlanningLease({ cwd: fixture.cwd, name: fixture.name, now: () => now, durationMs: 10 });
	const first = await adoptPlanningExecutionPolicy({ runtime: fixture.runtime, snapshot: fixture.snapshot });
	const work = first.record.work[0];
	const claimed = await claimPlanningAttempt({ runtime: fixture.runtime, workId: work.id, expectedInputDigest: work.inputDigest });
	if (!claimed.claimed) throw new Error('Expected an actual owned attempt');
	const changed = { ...fixture.runtime, model: 'next-model' };
	changed.executionPolicy = buildPlanningExecutionPolicy({ runtime: changed, standards: fixture.standards });
	return {
		...fixture,
		work,
		claimed,
		changed,
		expire: () => {
			now = 11;
		},
	};
};

const setupChanged = async () => {
	const fixture = await setup();
	const first = await adoptPlanningExecutionPolicy({ runtime: fixture.runtime, snapshot: fixture.snapshot });
	const changed = { ...fixture.runtime, model: 'next-model' };
	changed.executionPolicy = buildPlanningExecutionPolicy({ runtime: changed, standards: fixture.standards });
	await adoptPlanningExecutionPolicy({ runtime: changed, snapshot: first });
	return { ...fixture, first, changed };
};

describe('adoptPlanningExecutionPolicy', () => {
	test('publishes exact standards and an immutable stage policy together', async () => {
		const fixture = await setup();
		const first = await adoptPlanningExecutionPolicy({ runtime: fixture.runtime, snapshot: fixture.snapshot });
		const changed = { ...fixture.runtime, model: 'next-model' };
		changed.executionPolicy = buildPlanningExecutionPolicy({ runtime: changed, standards: fixture.standards });

		const second = await adoptPlanningExecutionPolicy({ runtime: changed, snapshot: first });

		expect(readPlanningExecutionPolicy({ snapshot: second, stage: PlanningVocabulary.Stage.Implementation })).toEqual(changed.executionPolicy);
		expect(second.artifacts.get(fixture.policy.reference.artifact)).toBe(first.artifacts.get(fixture.policy.reference.artifact));
		expect(JSON.parse(second.artifacts.get('planning-standards.json') ?? '{}').policyDigest).toBe(fixture.standards.policyDigest);
	});

	test.each([true, false])('rejects a transaction without current captured authority (bound=%s)', async (bound) => {
		const fixture = await setupChanged();
		const runtime = bound ? fixture.runtime : { ...fixture.runtime, executionPolicy: undefined };

		const transaction = updatePlanningSnapshot({ runtime, propose: async () => undefined });

		await expect(transaction).rejects.toThrow(bound ? 'execution policy changed' : 'lacks the adopted execution policy');
	});

	test('rejects stale identical-policy adoption after another stopped entry changed canonical policy', async () => {
		const fixture = await setupChanged();

		const adoption = adoptPlanningExecutionPolicy({ runtime: fixture.runtime, snapshot: fixture.first });

		await expect(adoption).rejects.toThrow('competing planning policy');
	});

	test('requires current-stage reviews for an author-only limit change while retaining completed authors', async () => {
		const fixture = await setup();
		await adoptPlanningExecutionPolicy({ runtime: fixture.runtime, snapshot: fixture.snapshot });
		const outcome = await fixture.run();
		expect(outcome.status).toBe('complete');
		const before = await fixture.current();
		const authorWork = before.record.work.filter((work) => work.role === PlanningVocabulary.Role.Architect || work.role === PlanningVocabulary.Role.Draft);
		const priorReviewPolicy = fixture.policy.policy.roles['design-review'].digest;
		fixture.runtime.config = { ...fixture.runtime.config, 'executor-file-limit': 19 };
		fixture.runtime.executionPolicy = buildPlanningExecutionPolicy({ runtime: fixture.runtime, standards: fixture.standards });

		const after = await adoptPlanningExecutionPolicy({ runtime: fixture.runtime, snapshot: before });

		expect(fixture.runtime.executionPolicy.policy.roles['design-review'].digest).toBe(priorReviewPolicy);
		expect(getCurrentPlanningReviews({ snapshot: after })).toEqual([]);
		expect(after.record.work.filter((work) => work.role === PlanningVocabulary.Role.Architect || work.role === PlanningVocabulary.Role.Draft)).toEqual(
			authorWork,
		);
		expect(planReviewCoverage({ snapshot: after, stage: fixture.runtime.stage })).toEqual(
			expect.arrayContaining([expect.objectContaining({ role: 'design-review', status: 'pending' })]),
		);
		expect(after.record.reviewReceipts).toEqual(before.record.reviewReceipts);
	});

	test('refuses to adopt over a live owner', async () => {
		const fixture = await setupOwned();

		await expect(adoptPlanningExecutionPolicy({ runtime: fixture.changed, snapshot: fixture.claimed.snapshot })).rejects.toThrow('active lease');

		expect((await fixture.current()).record.executionPolicies).toEqual([fixture.policy.reference]);
	});

	test('fences an expired owner and completes under a new attempt without inventing a diagnosis', async () => {
		const fixture = await setupOwned();
		const active = fixture.claimed.snapshot.record.work.find((item) => item.id === fixture.work.id);
		if (!active) throw new Error('Owned assignment disappeared');
		const oldOutput = await invokePlanningRole({ runtime: fixture.runtime, work: active, snapshot: fixture.claimed.snapshot });
		fixture.expire();
		Object.assign(fixture.runtime, fixture.changed);

		await adoptPlanningExecutionPolicy({ runtime: fixture.runtime, snapshot: await fixture.current() });
		const stale = await applyPlanningResult({ runtime: fixture.runtime, result: oldOutput });
		const result = await fixture.run();

		expect(stale.accepted).toBe(false);
		expect(result.status).toBe('complete');
		const completed = await fixture.current();
		expect(completed.record.work.find((item) => item.id === fixture.work.id)?.attemptSequence).toBe(2);
		expect(completed.record.work.some((item) => item.role === 'diagnose')).toBe(false);
		await expect(fixture.runtime.lease.renew({ attemptId: fixture.claimed.attemptId })).rejects.toThrow('fenced');
	});

	test('rejects an old runtime claim after a new policy was adopted', async () => {
		const fixture = await setupOwned();
		fixture.expire();
		await adoptPlanningExecutionPolicy({ runtime: fixture.changed, snapshot: fixture.claimed.snapshot });

		const claim = claimPlanningAttempt({ runtime: fixture.runtime, workId: fixture.work.id, expectedInputDigest: fixture.work.inputDigest });

		await expect(claim).rejects.toThrow('execution policy changed');
	});

	test('rejects removal of an adopted stage reference even when its immutable blob is retained', async () => {
		const fixture = await setup();
		const snapshot = await adoptPlanningExecutionPolicy({ runtime: fixture.runtime, snapshot: fixture.snapshot });

		const downgrade = commitPlanningSnapshot({
			cwd: fixture.cwd,
			name: fixture.name,
			expectedRevision: snapshot.record.revision,
			parentDigest: snapshot.digest,
			record: { ...snapshot.record, revision: snapshot.record.revision + 1, parentDigest: snapshot.digest, executionPolicies: [] },
			artifacts: snapshot.artifacts,
		});

		await expect(downgrade).rejects.toThrow('execution policy cannot be removed');
		expect((await fixture.current()).digest).toBe(snapshot.digest);
	});

	test('does not overwrite a competing policy after losing its adoption CAS', async () => {
		const fixture = await setup();
		const competitor = { ...fixture.runtime, model: 'competing-model' };
		competitor.executionPolicy = buildPlanningExecutionPolicy({ runtime: competitor, standards: fixture.standards });
		let raced = false;
		fixture.runtime.storeIO = {
			checkpoint: async ({ operation }) => {
				if (operation === 'candidate' && !raced) {
					raced = true;
					await adoptPlanningExecutionPolicy({ runtime: competitor, snapshot: fixture.snapshot });
				}
			},
		};

		await expect(adoptPlanningExecutionPolicy({ runtime: fixture.runtime, snapshot: fixture.snapshot })).rejects.toThrow('competing planning policy');

		const current = await readPlanningSnapshot(fixture);
		expect(current?.record.executionPolicies).toEqual([competitor.executionPolicy.reference]);
	});
});

test('refuses a runtime that lost its previously adopted policy', async () => {
	const fixture = await setup();
	const snapshot = await adoptPlanningExecutionPolicy({ runtime: fixture.runtime, snapshot: fixture.snapshot });
	await expect(adoptPlanningExecutionPolicy({ runtime: { ...fixture.runtime, executionPolicy: undefined }, snapshot })).rejects.toThrow(
		'lacks the adopted execution policy',
	);
});

test('refuses stale resolved standards before adopting policy', async () => {
	const fixture = await setup();
	fixture.policy.policy.standardsPolicyDigest = 'a'.repeat(64);
	await expect(adoptPlanningExecutionPolicy({ runtime: fixture.runtime, snapshot: fixture.snapshot })).rejects.toThrow(
		'standards changed before policy adoption',
	);
});

test('refuses adoption after the canonical generation disappears', async () => {
	const fixture = await setup();
	await rm(join(fixture.root, '.planning'), { recursive: true });
	await expect(adoptPlanningExecutionPolicy({ runtime: fixture.runtime, snapshot: fixture.snapshot })).rejects.toThrow(
		'generation disappeared before policy adoption',
	);
});

test('refuses dispatch when runtime settings drift after policy preparation', async () => {
	const fixture = await setupOwned();
	const work = fixture.claimed.snapshot.record.work.find((item) => item.id === fixture.work.id);
	if (!work) throw new Error('Missing claimed work');
	fixture.runtime.model = 'changed-after-preparation';
	await expect(assertPlanningDispatch({ runtime: fixture.runtime, driver: fixture.runtime.driver, work, standards: fixture.standards })).rejects.toThrow(
		'execution policy changed after preparation',
	);
});
