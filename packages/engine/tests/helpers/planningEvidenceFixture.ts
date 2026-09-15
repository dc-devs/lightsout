import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningEvidenceRequest, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import type { PlanningRuntime } from '#src/plan/index.ts';
import { commitPlanningSnapshot, PlanningLease, PlanningMode, resolvePlanningStandards } from '#src/plan/index.ts';
import { planningStoreFixture } from './planningStoreFixture.ts';

/** Real temporary repository and standards bundle; evidence tests never execute a paid provider. */
export const planningEvidenceFixture = async () => {
	const context = await planningStoreFixture();
	const { cwd, name, record, artifacts, scope } = context;
	const architecture = 'Reuse the shared upload service and preserve its idempotency key.';
	const origin = { artifact: 'notes.md', locator: 'Architecture', text: architecture, sha256: sha256({ content: architecture }) };
	record.sources.push(origin);
	record.claims.push({
		id: 'architecture',
		kind: PlanningVocabulary.ClaimKind.Architecture,
		text: architecture,
		explanation: '',
		contentRevision: 1,
		origin,
		owner: PlanningVocabulary.Owner.Planner,
		state: PlanningVocabulary.ClaimState.Settled,
		dependencies: [],
		scope,
	});
	const unused = () => {
		throw new Error('Evidence acquisition must not dispatch a role');
	};
	const runtime: PlanningRuntime = {
		cwd,
		name,
		config: {
			gates: { check: 'true', test: 'true', 'test-coverage': false },
			'standards-packs': false,
			docs: [{ path: 'README.md', covers: 'Document changed public workflows' }],
		},
		standards: '',
		mode: PlanningMode.Automatic,
		stage: PlanningVocabulary.Stage.Implementation,
		driver: { name: 'uncalled', invoke: unused },
		services: { draft: unused, validate: unused, invalidate: unused, evaluate: unused, integration: unused },
		lease: new PlanningLease({ cwd, name }),
	};
	const write = async (path: string, text: string) => {
		await mkdir(dirname(join(cwd, path)), { recursive: true });
		await writeFile(join(cwd, path), text);
	};
	await write('package.json', '{"name":"evidence-consumer"}');
	const standards = await resolvePlanningStandards({ cwd, config: runtime.config, scope, role: PlanningVocabulary.Role.Investigate });
	const content = canonicalJson({
		value: { format: 'planning-standards-v1', channels: standards.channels, observations: standards.observations, policyDigest: standards.policyDigest },
	});
	record.standards = standards.channels.map(({ text: _text, ...channel }) => ({ ...channel, artifact: 'planning-standards.json' }));
	artifacts.set('planning-standards.json', content);
	record.artifacts.push({
		path: 'planning-standards.json',
		variant: PlanningVocabulary.Artifact.Data,
		sha256: sha256({ content }),
		claimIds: [],
		prerequisiteIds: [],
		exports: [],
		boundaries: scope,
	});
	const work: PlanningWork = {
		id: 'investigator',
		role: PlanningVocabulary.Role.Investigate,
		stage: PlanningVocabulary.Stage.Implementation,
		scope,
		prerequisiteIds: [],
		inputDigest: sha256({ content: 'caller investigation' }),
		status: PlanningVocabulary.WorkState.Pending,
		attemptSequence: 0,
		failureIds: [],
		diagnosisIds: [],
		assignment: 'Find all upload callers',
	};
	record.work.push(work);
	const committed = await commitPlanningSnapshot({ cwd, name, expectedRevision: -1, parentDigest: null, record, artifacts });
	if (!committed.committed) throw new Error('Unexpected competing fixture writer');
	const request: PlanningEvidenceRequest = {
		requestId: 'callers',
		operation: PlanningVocabulary.Operation.Search,
		roots: ['src'],
		query: 'upload(',
		options: { regex: false, caseSensitive: true, glob: '**/*.ts', exclude: [] },
		reason: 'Find every caller including failure retries',
	};
	const policy = { exclude: ['.git', '.git/**', '.lightsout', '.lightsout/**'], identity: sha256({ content: 'test policy' }) };
	return { ...context, runtime, write, standards, work, snapshot: committed.snapshot, request, policy };
};
