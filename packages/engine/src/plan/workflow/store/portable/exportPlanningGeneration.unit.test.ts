import { describe, expect, test } from '@jest/globals';

// Dependencies
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { commitPlanningSnapshot, exportPlanningGeneration, planningDataArtifact, readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';
import { planningPortableFixture as setup } from '#tests/helpers/planningPortableFixture.ts';

describe('exportPlanningGeneration', () => {
	test('refuses a malformed observation namespace instead of publishing its raw source', async () => {
		const fixture = await setup();
		const snapshot = { ...fixture.snapshot, record: structuredClone(fixture.snapshot.record), artifacts: new Map(fixture.snapshot.artifacts) };
		attachPlanningData({ record: snapshot.record, artifacts: snapshot.artifacts, path: 'planning-observations/malformed.json', value: fixture.observation });

		expect(() => exportPlanningGeneration({ snapshot })).toThrow('Malformed local observation');
	});

	test('refuses omission when a finding relies on the captured observation itself', async () => {
		const fixture = await setup();
		const record = structuredClone(fixture.snapshot.record);
		record.findings.push({
			id: 'captured-authority',
			observationIds: ['required'],
			scope: fixture.scope,
			scenario: 'Retry fails',
			consequence: 'Completion lost',
			missingObligation: 'Retain completion',
			severity: PlanningVocabulary.Severity.Blocking,
			owner: PlanningVocabulary.Owner.Planner,
			state: PlanningVocabulary.FindingState.Open,
			resolutionClaimIds: [],
			resolutionArtifacts: [],
			verificationReceiptIds: [],
			citations: [{ artifact: fixture.observationPath, quote: 'local only', sha256: sha256({ content: canonicalJson({ value: fixture.observation }) }) }],
		});
		const snapshot = { ...fixture.snapshot, record, digest: sha256({ content: canonicalJson({ value: record }) }) };

		expect(() => exportPlanningGeneration({ snapshot })).toThrow('omit required citation authority');
	});

	test('commits and republishes a successor without rehydrating omitted historical observations', async () => {
		const fixture = await setup();
		const restored = await fixture.restore();
		const before = restored.snapshot;
		const committed = await commitPlanningSnapshot({
			...restored,
			expectedRevision: before.record.revision,
			parentDigest: before.digest,
			record: { ...before.record, revision: before.record.revision + 1, parentDigest: before.digest },
			artifacts: before.artifacts,
		});
		if (!committed.committed) throw new Error('Unexpected competing successor');
		const body = exportPlanningGeneration({ snapshot: committed.snapshot }).get('planning-record.json');
		const again = await fixture.restore({ body });

		expect(again.snapshot.digest).toBe(committed.snapshot.digest);
		expect(again.snapshot.record.parentDigest).toBe(before.digest);
		expect(again.snapshot.record.revision).toBe(before.record.revision + 1);
		expect(again.snapshot.artifacts.has(fixture.observationPath)).toBe(false);
		expect((await readPlanningSnapshot({ ...restored, generation: before.digest }))?.record).toEqual(before.record);
	});

	test('retains source authority required by a pending adjudication request', async () => {
		const fixture = await setup();
		const record = structuredClone(fixture.snapshot.record);
		const artifacts = new Map(fixture.snapshot.artifacts);
		attachPlanningData({
			record,
			artifacts,
			path: `planning-adjudication-requests/${sha256({ content: 'dispute' })}.json`,
			value: {
				workId: 'dispute',
				request: {
					findingIds: ['finding'],
					reason: PlanningVocabulary.Dispute.ContestedResolution,
					explanation: 'The captured output contradicts the resolution',
					citations: [{ artifact: fixture.observationPath, quote: 'local only', sha256: sha256({ content: canonicalJson({ value: fixture.observation }) }) }],
				},
			},
		});
		const snapshot = { ...fixture.snapshot, record, artifacts, digest: sha256({ content: canonicalJson({ value: record }) }) };

		expect(() => exportPlanningGeneration({ snapshot })).toThrow('omit required citation authority');
	});
});

test.each(['missing', 'changed', 'nested-view', 'noncanonical-observation'])('refuses unusable publication content: %s', async (defect) => {
	const fixture = await setup();
	const snapshot = { ...fixture.snapshot, record: structuredClone(fixture.snapshot.record), artifacts: new Map(fixture.snapshot.artifacts) };
	if (defect === 'missing') snapshot.artifacts.delete('custom-data.json');
	if (defect === 'changed') snapshot.artifacts.set('custom-data.json', '{}');
	if (defect === 'nested-view') {
		const text = '# Nested view';
		const path = 'nested/plan.md';
		snapshot.artifacts.set(path, text);
		snapshot.record.artifacts.push({ ...planningDataArtifact({ path, content: text }), variant: PlanningVocabulary.Artifact.Single });
	}
	if (defect === 'noncanonical-observation') {
		const text = JSON.stringify(fixture.observation, null, 2);
		const digest = sha256({ content: text });
		const path = `planning-observations/${digest}.json`;
		snapshot.artifacts.set(path, text);
		snapshot.record.artifacts.push(planningDataArtifact({ path, content: text }));
	}
	expect(() => exportPlanningGeneration({ snapshot })).toThrow(/Missing planning artifact|Changed planning|bare attachment|canonical before omission/);
});
