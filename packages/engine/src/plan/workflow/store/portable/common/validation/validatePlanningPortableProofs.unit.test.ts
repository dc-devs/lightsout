import { beforeAll, describe, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { PlanningBaseline } from '#src/plan/workflow/common/types/invocation/PlanningBaseline.ts';
import { PlanningInvocation } from '#src/plan/workflow/common/types/invocation/PlanningInvocation.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { validatePlanningPortableProofs } from '#src/plan/workflow/store/portable/common/validation/validatePlanningPortableProofs.ts';
import { planningHandoffFixture } from '#tests/helpers/planningHandoffFixture.ts';

let original: PlanningSnapshot;
beforeAll(async () => {
	const fixture = await planningHandoffFixture();
	original = await fixture.current();
});
const setup = () => ({ ...structuredClone(original), artifacts: new Map(original.artifacts) });
const replace = ({ snapshot, path, value }: { snapshot: ReturnType<typeof setup>; path: string; value: unknown }) =>
	attachPlanningData({ record: snapshot.record, artifacts: snapshot.artifacts, path, value });

describe('validatePlanningPortableProofs', () => {
	test('accepts a complete independent planning history', () => {
		expect(() => validatePlanningPortableProofs({ snapshot: setup() })).not.toThrow();
	});
	test('refuses loss of exact original wording', () => {
		const snapshot = setup();
		snapshot.artifacts.delete(`planning-originals/${snapshot.record.sources[0].sha256}.txt`);
		expect(() => validatePlanningPortableProofs({ snapshot })).toThrow('complete original');
	});
	test('refuses standards descriptors that disagree with full text', () => {
		const snapshot = setup();
		snapshot.record.standards = [];
		expect(() => validatePlanningPortableProofs({ snapshot })).toThrow('full channels');
	});
	test.each(['missing', 'address', 'observation'])('refuses damaged invocation authority: %s', (defect) => {
		const snapshot = setup();
		const descriptor = snapshot.record.artifacts.find((item) => item.path.startsWith('planning-invocations/'));
		if (!descriptor) throw new Error('Expected invocation');
		if (defect === 'missing') snapshot.artifacts.delete(descriptor.path);
		else {
			const invocation = PlanningInvocation.parse(JSON.parse(snapshot.artifacts.get(descriptor.path) ?? 'null'));
			if (defect === 'address') invocation.id = 'substituted-id';
			else invocation.observationPaths.push('planning-observations/missing.json');
			replace({ snapshot, path: descriptor.path, value: invocation });
		}
		expect(() => validatePlanningPortableProofs({ snapshot })).toThrow(/invocation|observation descriptor/);
	});
	test.each(['missing', 'workId', 'attemptId', 'resultReceiptId', 'acceptedRevision'])(
		'refuses a result without its matching accepted baseline: %s',
		(defect) => {
			const snapshot = setup();
			const path = snapshot.record.artifacts.find((item) => item.path.startsWith('planning-baselines/'))?.path;
			if (!path) throw new Error('Expected baseline');
			if (defect === 'missing') snapshot.artifacts.delete(path);
			else {
				const baseline = PlanningBaseline.parse(JSON.parse(snapshot.artifacts.get(path) ?? 'null'));
				if (defect === 'acceptedRevision') baseline.acceptedRevision += 1;
				else if (defect === 'workId') baseline.workId = 'different';
				else if (defect === 'attemptId') baseline.attemptId = 'different';
				else baseline.resultReceiptId = 'different';
				replace({ snapshot, path, value: baseline });
			}
			expect(() => validatePlanningPortableProofs({ snapshot })).toThrow('accepted baseline');
		},
	);
	test.each(['invocationPolicyDigest', 'executionPolicyDigest', 'observationPaths'])('refuses a baseline not backed by the actual invocation: %s', (defect) => {
		const snapshot = setup();
		const path = snapshot.record.artifacts.find((item) => item.path.startsWith('planning-baselines/'))?.path;
		if (!path) throw new Error('Expected baseline');
		const baseline = PlanningBaseline.parse(JSON.parse(snapshot.artifacts.get(path) ?? 'null'));
		if (defect === 'observationPaths') baseline.observationPaths = ['different.json'];
		else if (defect === 'invocationPolicyDigest') baseline.invocationPolicyDigest = sha256({ content: 'different' });
		else baseline.executionPolicyDigest = sha256({ content: 'different' });
		replace({ snapshot, path, value: baseline });
		expect(() => validatePlanningPortableProofs({ snapshot })).toThrow('actual invocation');
	});
	test.each(['invocationId', 'workId', 'attemptId', 'inputDigest', 'dependencies'])('refuses review authority from a different invocation: %s', (defect) => {
		const snapshot = setup();
		const receipt = snapshot.record.reviewReceipts[0];
		if (defect === 'invocationId') receipt.issuer.invocationId = 'different';
		if (defect === 'workId') receipt.workId = 'different';
		if (defect === 'attemptId') receipt.attemptId = 'different';
		if (defect === 'inputDigest') receipt.inputDigest = sha256({ content: 'different' });
		if (defect === 'dependencies') receipt.dependencies = [];
		expect(() => validatePlanningPortableProofs({ snapshot })).toThrow('actual independent invocation');
	});
});
