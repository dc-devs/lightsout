import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningArtifact, type PlanningClaim, type PlanningRecord, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import {
	claimPlanningAttempt,
	commitPlanningSnapshot,
	type PlanningRuntime,
	type PlanningSnapshot,
	readPlanningSnapshot,
	resolvePlanningStandards,
} from '#src/plan/index.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

/** Canonical, hash-bound views and full original obligations for the draft acceptance boundary. */
export const planningDraftFixture = async ({ exactStandards = false, repair = false } = {}) => {
	const fixture = await planningWorkflowFixture();
	fixture.runtime.driver = {
		name: fixture.runtime.driver.name,
		invoke: async (invocation) => {
			fixture.calls.push(invocation);
			const response = (
				JSON.parse(invocation.prompt) as {
					identity: { role: string; workId: string; attemptId: string; inputDigest: string; invocationId: string; packetDigest: string };
				}
			).identity;
			const snapshot = await readPlanningSnapshot({ cwd: fixture.cwd, name: fixture.name });
			if (!snapshot) throw new Error('Repair called before canonical snapshot');
			const prior = snapshot.record.artifacts.find((artifact) => artifact.phaseId === 'A');
			if (!prior) throw new Error('Repair fixture lost stable phase A');
			const { sha256: _hash, ...layout } = prior;
			return {
				exitCode: 0,
				text: JSON.stringify({
					...response,
					kind: 'terminal',
					dependencies: [],
					claims: [],
					resolutions: [],
					artifactLayouts: [
						{ ...layout, path: 'phase1-upload.md', baseDescriptorDigest: sha256({ content: canonicalJson({ value: prior }) }) },
						{ ...layout, path: 'phase2-retry.md', phaseId: 'B', claimIds: [], prerequisiteIds: ['A'], exports: [], baseDescriptorDigest: null },
					],
					artifactEdits: [
						{ path: 'phase1-upload.md', baseHash: null, content: '# Upload\n\n## Context\n\nRetain completed uploads. Retry behavior moves to phase B.\n' },
						{ path: 'phase2-retry.md', baseHash: null, content: '# Retry\n\n## Context\n\nReuse the same idempotency key after failure.\n' },
					],
				}),
			};
		},
	};
	const captured = await fixture.capture();
	const original = captured.record.claims[0];
	if (!original) throw new Error('Draft fixture has no original requirement');
	const phaseScope = { kind: PlanningVocabulary.Scope.Selected, claimIds: [], phaseIds: ['A'], packageRoots: [] };
	const common = { ...original, owner: PlanningVocabulary.Owner.Planner, confirmationId: undefined, scope: phaseScope, dependencies: ['required'] };
	const claims: PlanningClaim[] = [
		original,
		{
			...common,
			id: 'shared-api',
			kind: PlanningVocabulary.ClaimKind.Contract,
			text: 'Retry preserves completed uploads.',
			contract: {
				signatures: ['retryUpload({ uploadId }: { uploadId: string }): Promise<Upload>'],
				ordering: ['Read completion before scheduling another write.'],
				failures: ['A failed retry must not delete completed uploads.'],
				boundaries: ['Only the upload service owns retry identity.'],
			},
		},
		{
			...common,
			id: 'retry-choice',
			kind: PlanningVocabulary.ClaimKind.Decision,
			text: 'Reuse the original idempotency key.',
			explanation: 'A retry must not create a duplicate upload.',
		},
		{
			...common,
			id: 'test-retry',
			kind: PlanningVocabulary.ClaimKind.Acceptance,
			text: 'Exercise retries after a partial failure.',
			dependencies: ['required', 'shared-api', 'retry-choice'],
			acceptance: {
				kind: PlanningVocabulary.Acceptance.Test,
				criterion: 'Given a retry failure, keep the completed upload.',
				testFile: 'src/retryUpload.unit.test.ts',
				testName: 'retains uploads | after retry\nfailure',
				gate: 'test',
			},
		},
	];
	const proseA =
		'# Upload plan\n\n## Context\n\nPreserve completed uploads and reuse the same idempotency key.\n\n```md\n## Acceptance Tests\nThis example heading is implementation prose, not an engine section.\n```\n\n## Files to Create\n\n### `src/retryUpload.ts`\n\nImplement the shared retry contract without deleting completed data.\n';
	const proseC = '# Unrelated report\n\n## Context\n\nLeave the report formatter and its ordering unchanged.\n';
	const artifacts = new Map(captured.artifacts);
	const views = [
		{ path: 'overview.md', variant: PlanningVocabulary.Artifact.Overview, content: '# Upload system\n\n## Context\n\nPreserve approved upload behavior.\n' },
		{ path: 'phase1-original.md', variant: PlanningVocabulary.Artifact.Phase, phaseId: 'A', content: proseA },
		{ path: 'phase3-report.md', variant: PlanningVocabulary.Artifact.Phase, phaseId: 'C', content: proseC },
	];
	const descriptors: PlanningArtifact[] = views.map(({ content, ...view }) => {
		artifacts.set(view.path, content);
		return {
			...view,
			sha256: sha256({ content }),
			claimIds: view.phaseId === 'A' ? claims.map((claim) => claim.id) : [],
			prerequisiteIds: [],
			exports: view.phaseId === 'A' ? ['retryUpload'] : [],
			boundaries: view.phaseId ? { ...phaseScope, phaseIds: [view.phaseId] } : fixture.scope,
		};
	});
	const standards = await resolvePlanningStandards({
		cwd: fixture.cwd,
		config: fixture.runtime.config,
		role: PlanningVocabulary.Role.Draft,
		scope: fixture.scope,
	});
	const channels = exactStandards
		? [
				{ channel: PlanningVocabulary.Channel.Code, text: 'Code standard: preserve explicit failure ownership.\n' },
				{ channel: PlanningVocabulary.Channel.Test, text: 'Test standard: assert externally visible outcomes.\n' },
				{ channel: PlanningVocabulary.Channel.Docs, text: 'Docs standard: describe every exported contract.\n' },
			].map(({ channel, text }) => ({
				channel,
				text,
				sourceIdentity: `recorded:${channel}`,
				policyDigest: standards.policyDigest,
				sha256: sha256({ content: text }),
			}))
		: standards.channels;
	const bundle = canonicalJson({
		value: { format: 'planning-standards-v1', policyDigest: standards.policyDigest, observations: standards.observations, channels },
	});
	artifacts.set('planning-standards.json', bundle);
	const data: PlanningArtifact = {
		path: 'planning-standards.json',
		variant: PlanningVocabulary.Artifact.Data,
		sha256: sha256({ content: bundle }),
		claimIds: [],
		prerequisiteIds: [],
		exports: [],
		boundaries: fixture.scope,
	};
	const selected: PlanningWork = {
		id: 'targeted-repair',
		role: PlanningVocabulary.Role.Repair,
		stage: PlanningVocabulary.Stage.Implementation,
		scope: phaseScope,
		prerequisiteIds: [],
		inputDigest: sha256({ content: 'repair phase A after an oversized implementation boundary' }),
		status: PlanningVocabulary.WorkState.Pending,
		attemptSequence: 0,
		failureIds: [],
		diagnosisIds: [],
		assignment: 'Split only phase A into the retained A and a new phase B. Preserve unrelated phase C.',
	};
	const record: PlanningRecord = {
		...captured.record,
		revision: captured.record.revision + 1,
		parentDigest: captured.digest,
		claims,
		artifacts: [...captured.record.artifacts, ...descriptors, data],
		standards: channels.map(({ text: _text, ...channel }) => ({ ...channel, artifact: 'planning-standards.json' })),
		work: repair ? [...captured.record.work, selected] : captured.record.work,
	};
	const saved = await commitPlanningSnapshot({
		cwd: fixture.cwd,
		name: fixture.name,
		expectedRevision: captured.record.revision,
		parentDigest: captured.digest,
		record,
		artifacts,
	});
	if (!saved.committed) throw new Error('Draft fixture lost its commit');
	let snapshot: PlanningSnapshot = saved.snapshot;
	let work = selected;
	if (repair) {
		const claimed = await claimPlanningAttempt({ runtime: fixture.runtime, workId: selected.id, expectedInputDigest: selected.inputDigest });
		if (!claimed.claimed) throw new Error('Draft fixture did not claim the real repair');
		snapshot = claimed.snapshot;
		const active = snapshot.record.work.find((item) => item.id === selected.id);
		if (!active) throw new Error('Claimed repair disappeared');
		work = active;
	}
	const deltas: NonNullable<Parameters<PlanningRuntime['services']['invalidate']>[0]['delta']>[] = [];
	fixture.runtime.services.invalidate = ({ delta }) => {
		if (delta) deltas.push(delta);
		return { workIds: [], receiptIds: [], reason: 'Observe exact affected handoff inputs' };
	};
	return { ...fixture, snapshot, work, channels, proseA, proseC, deltas };
};
