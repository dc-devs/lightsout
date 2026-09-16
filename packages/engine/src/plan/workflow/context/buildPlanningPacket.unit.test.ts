import { rm } from 'node:fs/promises';
import { afterEach, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningScope, PlanningVocabulary } from '#src/contracts/index.ts';
import { buildPlanningPacket } from '#src/plan/workflow/context/buildPlanningPacket.ts';
import { planningEvidenceFixture } from '#tests/helpers/planningEvidenceFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async () => {
	const context = await planningEvidenceFixture();
	directories.push(context.cwd);
	const selected: PlanningScope = { kind: PlanningVocabulary.Scope.Selected, claimIds: ['required'], phaseIds: [], packageRoots: [] };
	const outside: PlanningScope = { kind: PlanningVocabulary.Scope.Selected, claimIds: [], phaseIds: [], packageRoots: ['packages/other'] };
	const record = structuredClone(context.snapshot.record);
	record.work.push({ ...context.work, id: 'previous-investigation' });
	record.claims[0] = { ...record.claims[0], scope: selected, dependencies: ['technical'] };
	record.claims.push({
		...record.claims[0],
		id: 'technical',
		text: 'Use the shared retry adapter',
		owner: PlanningVocabulary.Owner.Planner,
		confirmationId: undefined,
		scope: outside,
		dependencies: ['source-input'],
	});
	const text = 'export const adapter = true;';
	await context.write('src/adapter.ts', text);
	record.evidence.push({
		id: 'indirect-evidence',
		assignmentId: 'previous-investigation',
		claimIds: [],
		conclusion: 'Existing shared adapter provides retry identity',
		dependencies: [{ id: 'source-input', kind: PlanningVocabulary.Dependency.Content, path: 'src/adapter.ts', sha256: sha256({ content: text }) }],
		uncertaintyIds: [],
		complete: true,
		acquisition: 'accepted investigation',
		dependencyReach: PlanningVocabulary.DependencyReach.Known,
		sourceIds: ['src/adapter.ts'],
		configDigest: context.origin.sha256,
		standardsDigest: context.origin.sha256,
	});
	const phaseText = 'Shared adapter contract';
	record.artifacts.push({
		...context.descriptor,
		path: 'shared.md',
		phaseId: 'shared',
		variant: PlanningVocabulary.Artifact.Phase,
		boundaries: outside,
		claimIds: ['technical'],
		exports: ['retryUpload'],
		sha256: sha256({ content: phaseText }),
	});
	const artifacts = new Map(context.snapshot.artifacts);
	artifacts.set('shared.md', phaseText);
	return { ...context, record, snapshot: { ...context.snapshot, record, artifacts }, work: { ...context.work, scope: selected } };
};
test('includes indirectly referenced evidence and transitive phase contracts', async () => {
	const { snapshot, work, standards } = await setup();

	const packet = buildPlanningPacket({ snapshot, work: { ...work, role: PlanningVocabulary.Role.ImplementationReview }, standards, evidence: [] });

	const content = JSON.parse(packet.prompt);
	expect(content.claims.map((claim: { id: string }) => claim.id)).toStrictEqual(['architecture', 'required', 'technical']);
	expect(content.conclusions).toStrictEqual(snapshot.record.evidence);
	expect(content.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'source-input', path: 'src/adapter.ts' })]));
	expect(content.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'Shared adapter contract' })]));
});
const setupDrift = async ({ artifact = false }: { artifact?: boolean } = {}) => {
	const context = await setup();
	const packet = buildPlanningPacket({ snapshot: context.snapshot, work: context.work, standards: context.standards, evidence: [] });
	const record = structuredClone(context.record);
	if (artifact) record.artifacts.at(-1)?.exports.push('cancelUpload');
	else {
		const claim = record.claims.find((item) => item.id === 'technical');
		if (claim === undefined) throw new Error('Missing technical fixture');
		claim.text = 'Use a different retry identity';
	}
	return { ...context, packet, record };
};
test('invalidates an out-of-scope prerequisite claim that was included in the packet', async () => {
	const { snapshot, work, packet, record, standards } = await setupDrift();

	const result = buildPlanningPacket({ snapshot: { ...snapshot, record }, work, standards, evidence: [] });

	expect(result.inputDigest).not.toBe(packet.inputDigest);
	expect(result.dependencies.find((item) => item.id.startsWith('collection:claims:'))).not.toEqual(
		packet.dependencies.find((item) => item.id.startsWith('collection:claims:')),
	);
});
test('invalidates exports reached through a transitive prerequisite claim', async () => {
	const { snapshot, work, packet, record, standards } = await setupDrift({ artifact: true });

	const result = buildPlanningPacket({ snapshot: { ...snapshot, record }, work, standards, evidence: [] });

	expect(result.inputDigest).not.toBe(packet.inputDigest);
	expect(result.dependencies.find((item) => item.id.startsWith('collection:exports:'))).not.toEqual(
		packet.dependencies.find((item) => item.id.startsWith('collection:exports:')),
	);
});
test('refuses an unresolved semantic prerequisite rather than dropping it', async () => {
	const { snapshot, work, standards } = await setup();
	const claim = snapshot.record.claims.find((item) => item.id === 'technical');
	if (claim === undefined) throw new Error('Missing technical fixture');
	claim.dependencies = ['missing-evidence'];

	expect(() => buildPlanningPacket({ snapshot, work, standards, evidence: [] })).toThrow(/unresolved dependency/);
});
const setupInvalidBundle = async ({ mode }: { mode: 'absent' | 'checksum' | 'channel' | 'descriptor' | 'count' }) => {
	const context = await setup();
	const artifacts = new Map(context.snapshot.artifacts);
	const record = structuredClone(context.record);
	const path = 'planning-standards.json';
	if (mode === 'absent') artifacts.delete(path);
	else if (mode === 'checksum') artifacts.set(path, '{}');
	else {
		const bundle = JSON.parse(artifacts.get(path) ?? '');
		if (mode === 'channel') bundle.channels[0].text += 'Unapproved substitution';
		if (mode === 'descriptor') record.standards[0].sourceIdentity = 'different source';
		if (mode === 'count') record.standards = [];
		const text = JSON.stringify(bundle);
		artifacts.set(path, text);
		const descriptor = record.artifacts.find((item) => item.path === path);
		if (descriptor === undefined) throw new Error('Missing fixture bundle');
		descriptor.sha256 = sha256({ content: text });
	}
	return { ...context, snapshot: { ...context.snapshot, record, artifacts } };
};
test.each([
	{ mode: 'absent' as const, error: /bundle is missing/ },
	{ mode: 'checksum' as const, error: /checksum/ },
	{ mode: 'channel' as const, error: /Changed committed standards bytes/ },
	{ mode: 'descriptor' as const, error: /does not bind/ },
	{ mode: 'count' as const, error: /complete bundle/ },
])('refuses $mode committed standards before building a role context', async ({ mode, error }) => {
	const { snapshot, work, standards } = await setupInvalidBundle({ mode });

	expect(() => buildPlanningPacket({ snapshot, work, standards, evidence: [] })).toThrow(error);
});
const setupUncommittedStandards = async () => {
	const context = await setup();
	return { ...context, standards: { ...context.standards, policyDigest: sha256({ content: 'new unresolved standards' }) } };
};
test('requires new standards resolution to be committed before dispatch context is produced', async () => {
	const { snapshot, work, standards } = await setupUncommittedStandards();

	expect(() => buildPlanningPacket({ snapshot, work, standards, evidence: [] })).toThrow(/must be committed/);
});
const setupMissingArtifact = async () => {
	const context = await setup();
	const artifacts = new Map(context.snapshot.artifacts);
	artifacts.delete('shared.md');
	return { ...context, snapshot: { ...context.snapshot, artifacts } };
};
test('refuses unavailable transitive phase bytes instead of omitting their contract', async () => {
	const { snapshot, work, standards } = await setupMissingArtifact();

	expect(() => buildPlanningPacket({ snapshot, work, standards, evidence: [] })).toThrow(/missing committed artifact shared.md/);
});
const setupConflictingEvidence = async () => {
	const context = await setup();
	const original = context.record.evidence[0];
	const conflicting = {
		...original,
		id: 'changed-input',
		dependencies: [{ id: 'source-input', kind: PlanningVocabulary.Dependency.Content, path: 'src/adapter.ts', sha256: sha256({ content: 'contradiction' }) }],
	};
	return { ...context, evidence: [{ evidence: conflicting, content: 'Contradictory current evidence' }] };
};
test('requires conflicting source observations to be reconciled before a role can reason over them', async () => {
	const { snapshot, work, standards, evidence } = await setupConflictingEvidence();

	expect(() => buildPlanningPacket({ snapshot, work, standards, evidence })).toThrow(/Conflicting planning evidence/);
});

const setupUnclassifiedSources = async () => {
	const context = await setup();
	const record = structuredClone(context.snapshot.record);
	record.claims = [];
	record.evidence = [];
	record.confirmations = [];
	record.artifacts = record.artifacts.map((artifact) => ({ ...artifact, claimIds: [], boundaries: context.scope }));
	const work = { ...context.work, scope: context.scope };
	record.work = [work];
	return { ...context, work, snapshot: { ...context.snapshot, record } };
};
test('preserves original notes before an investigator has classified any claims', async () => {
	const { snapshot, work, standards } = await setupUnclassifiedSources();

	const result = buildPlanningPacket({ snapshot, work, standards, evidence: [] });

	expect(JSON.parse(result.prompt).sources).toEqual(expect.arrayContaining(snapshot.record.sources));
	expect(JSON.parse(result.prompt).sources).toHaveLength(snapshot.record.sources.length);
});

const setupMissingPrerequisiteArtifact = async () => {
	const context = await setup();
	const artifact = context.snapshot.record.artifacts.find((item) => item.path === 'shared.md');
	if (artifact === undefined) throw new Error('Missing shared fixture artifact');
	artifact.prerequisiteIds = ['absent-phase'];
	return context;
};
test('refuses an unavailable execution prerequisite instead of omitting its handoff', async () => {
	const { snapshot, work, standards } = await setupMissingPrerequisiteArtifact();

	expect(() => buildPlanningPacket({ snapshot, work, standards, evidence: [] })).toThrow(/prerequisite is unavailable: absent-phase/);
});

const setupIncompleteInvestigation = async () => {
	const context = await setup();
	context.snapshot.record.evidence[0].complete = false;
	const work = {
		...context.work,
		role: PlanningVocabulary.Role.Investigate,
		status: PlanningVocabulary.WorkState.Running,
		currentAttemptId: 'active-investigator',
	};
	return { ...context, work };
};
test('gives only a claimed investigator explicit incomplete evidence without reusing it as a conclusion', async () => {
	const { snapshot, work, standards } = await setupIncompleteInvestigation();

	const packet = buildPlanningPacket({ snapshot, work, standards, evidence: [] });
	const content = JSON.parse(packet.prompt);

	expect(content.incompleteEvidence).toStrictEqual(snapshot.record.evidence);
	expect(content.conclusions).toStrictEqual([]);
	expect(packet.dependencies.some((dependency) => dependency.id === 'source-input')).toBe(false);
	expect(() => buildPlanningPacket({ snapshot, work: { ...work, currentAttemptId: undefined }, standards, evidence: [] })).toThrow(/incomplete evidence/);
	expect(() => buildPlanningPacket({ snapshot, work: { ...work, role: PlanningVocabulary.Role.Draft }, standards, evidence: [] })).toThrow(
		/incomplete evidence/,
	);
});
