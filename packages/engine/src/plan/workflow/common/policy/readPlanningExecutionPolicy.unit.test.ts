import { beforeAll, expect, test } from '@jest/globals';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { createPlanningRuntime, readPlanningSnapshot } from '#src/plan/index.ts';
import { PlanningExecutionPolicy } from '#src/plan/workflow/common/policy/PlanningExecutionPolicy.ts';
import { readPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/readPlanningExecutionPolicy.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

let fixture: Awaited<ReturnType<typeof planningWorkflowFixture>>;
beforeAll(async () => {
	fixture = await planningWorkflowFixture();
	Object.assign(
		fixture.runtime,
		await createPlanningRuntime({
			...fixture,
			driver: fixture.runtime.driver,
			config: fixture.runtime.config,
			mode: fixture.runtime.mode,
			stage: fixture.runtime.stage,
		}),
	);
	await fixture.capture();
});
const setup = async () => {
	const original = await readPlanningSnapshot(fixture);
	if (!original) throw new Error('Expected captured snapshot');
	return { ...structuredClone(original), artifacts: new Map(original.artifacts) };
};

test.each(['duplicate', 'address', 'descriptor', 'hash', 'missing', 'changed'])('refuses invalid adopted planning policy: %s', async (defect) => {
	const snapshot = await setup();
	const reference = snapshot.record.executionPolicies?.[0];
	if (!reference) throw new Error('Expected policy');
	if (defect === 'duplicate') snapshot.record.executionPolicies?.push(reference);
	if (defect === 'address') reference.artifact = 'different.json';
	if (defect === 'descriptor') snapshot.record.artifacts = snapshot.record.artifacts.filter((item) => item.path !== reference.artifact);
	if (defect === 'hash') {
		const descriptor = snapshot.record.artifacts.find((item) => item.path === reference.artifact);
		if (!descriptor) throw new Error('Expected descriptor');
		descriptor.sha256 = 'b'.repeat(64);
	}
	if (defect === 'missing') snapshot.artifacts.delete(reference.artifact);
	if (defect === 'changed') snapshot.artifacts.set(reference.artifact, '{}');
	expect(() => readPlanningExecutionPolicy({ snapshot, stage: fixture.runtime.stage })).toThrow(/Duplicate|missing or corrupt/);
});

test('refuses a hash-consistent policy whose stage differs from its reference', async () => {
	const snapshot = await setup();
	const reference = snapshot.record.executionPolicies?.[0];
	if (!reference) throw new Error('Expected policy');
	const policy = PlanningExecutionPolicy.parse(JSON.parse(snapshot.artifacts.get(reference.artifact) ?? 'null'));
	policy.stage = 'brainstorm';
	const text = canonicalJson({ value: policy });
	const digest = sha256({ content: text });
	const descriptor = snapshot.record.artifacts.find((item) => item.path === reference.artifact);
	if (!descriptor) throw new Error('Expected descriptor');
	reference.sha256 = digest;
	reference.artifact = `planning-execution-policies/${digest}.json`;
	descriptor.path = reference.artifact;
	descriptor.sha256 = digest;
	snapshot.artifacts.set(reference.artifact, text);
	expect(() => readPlanningExecutionPolicy({ snapshot, stage: 'implementation' })).toThrow('stage mismatch');
});
