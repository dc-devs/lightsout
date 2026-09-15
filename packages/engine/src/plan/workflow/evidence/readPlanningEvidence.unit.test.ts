import { readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { buildPlanningPacket, resolvePlanningStandards } from '#src/plan/workflow/context/index.ts';
import { fingerprintPlanningDependencies, readPlanningEvidence } from '#src/plan/workflow/evidence/index.ts';
import { planningEvidenceFixture } from '#tests/helpers/planningEvidenceFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async () => {
	const context = await planningEvidenceFixture();
	directories.push(context.cwd);
	await context.write('src/known.ts', 'export const known = () => upload();');
	await context.write('src/other.ts', 'export const other = () => wait();');
	await context.write('outside/irrelevant.ts', 'export const ignored = true;');
	return context;
};
const exerciseCallers = async (context: Awaited<ReturnType<typeof setup>>) => {
	const { cwd, runtime, request, record, standards, policy, write } = context;
	const initial = await readPlanningEvidence({ runtime, assignmentId: 'investigator', request });
	await write('outside/irrelevant.ts', 'upload();');
	const unrelated = await fingerprintPlanningDependencies({ cwd, record, standards, policy, dependencies: initial.evidence.dependencies });
	await write('src/other.ts', 'export const other = () => upload();');
	const edited = await fingerprintPlanningDependencies({ cwd, record, standards, policy, dependencies: initial.evidence.dependencies });
	await write('src/new.ts', 'upload();');
	const added = await fingerprintPlanningDependencies({ cwd, record, standards, policy, dependencies: edited.dependencies });
	return {
		initial: JSON.parse(initial.content),
		unrelated: unrelated.current,
		edited: edited.current,
		added: added.current,
		unknown: added.unknown,
		inventedConclusion: initial.evidence.conclusion,
	};
};
test('invalidates new and previously nonmatching callers', async () => {
	const context = await setup();

	const result = await exerciseCallers(context);

	expect(result).toStrictEqual({
		initial: [{ path: 'src/known.ts', line: 1, text: 'export const known = () => upload();' }],
		unrelated: true,
		edited: false,
		added: false,
		unknown: false,
		inventedConclusion: '',
	});
});
const exerciseUnknowns = async (context: Awaited<ReturnType<typeof setup>>) => {
	const { cwd, runtime, record, standards, policy, request, write } = context;
	const missing = await readPlanningEvidence({
		runtime,
		assignmentId: 'investigator',
		request: { requestId: 'missing', operation: PlanningVocabulary.Operation.ReadFile, path: 'src/later.ts', reason: 'Check whether retry adapter exists' },
	});
	await write('src/later.ts', 'export const later = true;');
	const appeared = await fingerprintPlanningDependencies({ cwd, record, standards, policy, dependencies: missing.evidence.dependencies });
	const additional = await readPlanningEvidence({
		runtime,
		assignmentId: 'investigator',
		request: {
			requestId: 'outside',
			operation: PlanningVocabulary.Operation.ReadFile,
			path: 'outside/irrelevant.ts',
			reason: 'Follow a newly discovered call path',
		},
	});
	await symlink(join(cwd, 'outside/irrelevant.ts'), join(cwd, 'src/linked.ts'));
	const unobservable = await readPlanningEvidence({ runtime, assignmentId: 'investigator', request });
	await write('.lightsout/new-bookkeeping.json', '{"lease":"changed"}');
	const stableUnknown = await fingerprintPlanningDependencies({ cwd, record, standards, policy, dependencies: unobservable.evidence.dependencies });
	await write('outside/irrelevant.ts', 'export const ignored = () => upload();');
	const stillUnknown = await fingerprintPlanningDependencies({ cwd, record, standards, policy, dependencies: unobservable.evidence.dependencies });
	return {
		missing: JSON.parse(missing.content),
		appeared: appeared.current,
		additional: additional.evidence.dependencies,
		reach: unobservable.evidence.dependencyReach,
		unknownKinds: unobservable.evidence.dependencies.map((item) => item.kind),
		stable: stableUnknown.current,
		unknown: stillUnknown.unknown,
		fresh: stillUnknown.current,
	};
};
test('tracks absence additional reads and unknown harness access', async () => {
	const context = await setup();

	const result = await exerciseUnknowns(context);

	expect(result).toEqual({
		missing: { path: 'src/later.ts', exists: false },
		appeared: false,
		additional: [expect.objectContaining({ kind: 'content', path: 'outside/irrelevant.ts' })],
		reach: 'unknown',
		unknownKinds: ['search', 'unknown'],
		stable: true,
		unknown: true,
		fresh: false,
	});
});
const exerciseSharedContext = async (context: Awaited<ReturnType<typeof setup>>) => {
	const { runtime, request, snapshot, standards, work, cwd, name } = context;
	const first = await readPlanningEvidence({ runtime, assignmentId: work.id, request });
	const second = await readPlanningEvidence({ runtime, assignmentId: 'second', request: { ...request, reason: 'Confirm downstream retry paths' } });
	const packet = buildPlanningPacket({ snapshot, work, standards, evidence: [first] });
	const other = buildPlanningPacket({ snapshot, work: { ...work, role: PlanningVocabulary.Role.Architect }, standards, evidence: [second] });
	const index = JSON.parse(await readFile(join(cwd, '.lightsout/plans', name, 'source-evidence.json'), 'utf8'));
	const incompleteSnapshot = { ...snapshot, record: { ...snapshot.record, evidence: [{ ...first.evidence, complete: false }] } };
	let missingReported = false;
	try {
		buildPlanningPacket({ snapshot: incompleteSnapshot, work, standards, evidence: [] });
	} catch {
		missingReported = true;
	}
	return {
		sameBytes: index.entries[0].text === 'export const known = () => upload();',
		roles: index.entries[0].roles,
		system: packet.systemPrompt,
		first: JSON.parse(packet.prompt),
		other: JSON.parse(other.prompt),
		distinct: packet.inputDigest !== other.inputDigest,
		missingReported,
		semantics: index.acquisition.semantics,
	};
};
test('reuses source bytes while preserving binding context', async () => {
	const context = await setup();

	const result = await exerciseSharedContext(context);

	expect(result).toEqual(
		expect.objectContaining({
			sameBytes: true,
			roles: ['Find every caller including failure retries', 'Confirm downstream retry paths'],
			distinct: true,
			missingReported: true,
			semantics: 'bytes-only',
		}),
	);
	expect(result.first.claims).toStrictEqual(
		[...context.record.claims]
			.sort((a, b) => a.id.localeCompare(b.id))
			.map((claim) => ({ ...claim, origin: { artifact: claim.origin.artifact, locator: claim.origin.locator, sha256: claim.origin.sha256 } })),
	);
	expect(result.first.sources).toEqual(expect.arrayContaining(context.record.sources));
	expect(result.first.sources).toHaveLength(context.record.sources.length);
	expect(result.other.claims).toStrictEqual(result.first.claims);
	expect(result.other.sources).toStrictEqual(result.first.sources);
	expect(result.first.confirmations).toStrictEqual(context.record.confirmations);
	expect(result.first.standards).toStrictEqual(context.standards.channels.map(({ text: _text, ...descriptor }) => descriptor));
	for (const channel of context.standards.channels) expect(result.system).toContain(channel.text);
});
const setupStandards = async () => {
	const context = await setup();
	const config = { ...context.runtime.config, 'standards-packs': ['house'], docs: [{ path: 'README.md', covers: 'User-facing workflow' }] };
	return { ...context, config };
};
const exerciseStandards = async (context: Awaited<ReturnType<typeof setupStandards>>) => {
	const { cwd, config, scope, write } = context;
	const params = { cwd, config, scope, role: PlanningVocabulary.Role.Architect };
	let unavailable = false;
	try {
		await resolvePlanningStandards(params);
	} catch {
		unavailable = true;
	}
	await write('house/lightsout-standards.json', '{"name":"house","formatVersion":1}');
	await write('house/code/architecture/document.md', '# Architecture\nPreserve stable boundaries.');
	await write('house/tests/assertions/document.md', '# Tests\nAssert observable behavior.');
	const restored = await resolvePlanningStandards(params);
	return { unavailable, restored };
};
test('refuses unavailable configured standards', async () => {
	const context = await setupStandards();

	const result = await exerciseStandards(context);

	expect(result.unavailable).toBe(true);
	expect(result.restored.channels.map((channel) => channel.channel)).toStrictEqual(['code', 'test', 'docs']);
	expect(result.restored.content).toContain('Preserve stable boundaries.');
	expect(result.restored.content).toContain('Assert observable behavior.');
	expect(result.restored.content).toContain('README.md');
	expect(result.restored.dependencies).toEqual(
		expect.arrayContaining([expect.objectContaining({ kind: 'content', path: 'house/code/architecture/document.md' })]),
	);
});
