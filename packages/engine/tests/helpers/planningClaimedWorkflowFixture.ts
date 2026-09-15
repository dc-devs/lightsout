import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { type PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';
import { claimPlanningAttempt, commitPlanningSnapshot, PlanningLease, planningDataArtifact, resolvePlanningStandards } from '#src/plan/index.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

/** Real canonical input, committed standards and one claimed investigation, without a provider call. */
export const planningClaimedWorkflowFixture = async (options: Parameters<typeof planningWorkflowFixture>[0] = {}) => {
	const fixture = await planningWorkflowFixture(options);
	let now = 0;
	fixture.runtime.clock = () => now;
	fixture.runtime.lease = new PlanningLease({ cwd: fixture.cwd, name: fixture.name, now: () => now, durationMs: 30_000 });
	const snapshot = await fixture.capture();
	const standards = await resolvePlanningStandards({
		cwd: fixture.cwd,
		config: fixture.runtime.config,
		role: PlanningVocabulary.Role.Architect,
		scope: fixture.scope,
	});
	const text = canonicalJson({
		value: { format: 'planning-standards-v1', policyDigest: standards.policyDigest, observations: standards.observations, channels: standards.channels },
	});
	const artifacts = new Map(snapshot.artifacts);
	artifacts.set('planning-standards.json', text);
	const record: PlanningRecord = {
		...snapshot.record,
		revision: snapshot.record.revision + 1,
		parentDigest: snapshot.digest,
		standards: standards.channels.map(({ text: _text, ...descriptor }) => ({ ...descriptor, artifact: 'planning-standards.json' })),
		artifacts: [...snapshot.record.artifacts, planningDataArtifact({ path: 'planning-standards.json', content: text })],
	};
	const committed = await commitPlanningSnapshot({
		cwd: fixture.cwd,
		name: fixture.name,
		expectedRevision: snapshot.record.revision,
		parentDigest: snapshot.digest,
		record,
		artifacts,
	});
	if (!committed.committed) throw new Error('Standards fixture lost its transaction');
	const selected = committed.snapshot.record.work.find((work) => work.role === PlanningVocabulary.Role.Investigate);
	if (!selected) throw new Error('Fixture investigation is absent');
	const claimed = await claimPlanningAttempt({ runtime: fixture.runtime, workId: selected.id, expectedInputDigest: selected.inputDigest });
	if (!claimed.claimed) throw new Error('Fixture investigation was not claimed');
	const work = claimed.snapshot.record.work.find((item) => item.id === selected.id);
	if (!work) throw new Error('Claimed fixture work is absent');
	return {
		...fixture,
		standards,
		snapshot: claimed.snapshot,
		work,
		expire: () => {
			now += 60_000;
		},
	};
};
