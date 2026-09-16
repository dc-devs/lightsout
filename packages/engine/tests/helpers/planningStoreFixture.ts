import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningArtifact, type PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';
import { freshCwd } from './freshCwd.ts';

export const planningStoreFixture = async ({ name = 'store-contract' }: { name?: string } = {}) => {
	const cwd = await freshCwd();
	const scope = { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] };
	const text = 'Preserve completed uploads';
	const origin = { artifact: 'notes.md', locator: 'Requirement', text, sha256: sha256({ content: text }) };
	const descriptor: PlanningArtifact = {
		path: 'plan.md',
		variant: PlanningVocabulary.Artifact.Single,
		sha256: sha256({ content: text }),
		claimIds: ['required'],
		prerequisiteIds: [],
		exports: [],
		boundaries: scope,
	};
	const record: PlanningRecord = {
		schemaVersion: 1,
		planName: name,
		revision: 0,
		parentDigest: null,
		sources: [origin],
		claims: [
			{
				id: 'required',
				kind: PlanningVocabulary.ClaimKind.Requirement,
				text,
				explanation: '',
				contentRevision: 1,
				origin,
				owner: PlanningVocabulary.Owner.User,
				state: PlanningVocabulary.ClaimState.Settled,
				dependencies: [],
				scope,
				confirmationId: 'approval',
			},
		],
		evidence: [],
		work: [],
		findings: [],
		reviewReceipts: [],
		artifacts: [descriptor],
		confirmations: [
			{
				id: 'approval',
				channel: PlanningVocabulary.ConfirmationChannel.Foreground,
				messageId: 'message-1',
				messageText: text,
				approvedDigest: origin.sha256,
				delegation: scope,
			},
		],
		standards: [],
	};
	return { cwd, name, scope, text, origin, descriptor, record, artifacts: new Map([['plan.md', text]]), root: join(cwd, '.lightsout', 'plans', name) };
};

export const planningLegacyFixture = async () => {
	const fixture = await planningStoreFixture();
	const { cwd, name, root, scope, descriptor } = fixture;
	const runRoot = join(cwd, '.lightsout', 'runs', 'coordinator');
	await mkdir(root, { recursive: true });
	await mkdir(runRoot, { recursive: true });
	const files = [
		{ path: 'overview.md', text: 'Original overview' },
		{ path: 'phase1-first.md', text: 'Original phase one' },
		{ path: 'phase2-next.md', text: 'Original future phase' },
	];
	for (const file of files) await writeFile(join(root, file.path), file.text);
	const planPath = `.lightsout/plans/${name}/overview.md`;
	const manifest = JSON.stringify({
		runId: 'coordinator',
		plan: planPath,
		workspace: cwd,
		pipeline: 'phases',
		steps: [{ id: 'phase1-first.md' }, { id: 'phase2-next.md' }],
	});
	await writeFile(join(runRoot, 'manifest.json'), manifest);
	const rows = [
		{
			source: 'Grill',
			question: 'Retry?',
			options: 'Keep / discard',
			choice: 'Keep completed uploads',
			rationale: 'Preserve work',
			phases: ['phase2-next.md'],
		},
	];
	const decisions = JSON.stringify({ planName: name, decisions: rows }, null, 2);
	const artifacts = files.map((file, index) => {
		const content = `Replacement ${file.path}`;
		return {
			descriptor: {
				...descriptor,
				path: file.path,
				variant: index === 0 ? PlanningVocabulary.Artifact.Overview : PlanningVocabulary.Artifact.Phase,
				...(index === 0 ? {} : { phaseId: `stable-${index}` }),
				sha256: sha256({ content }),
				claimIds: [],
			},
			content,
		};
	});
	return {
		...fixture,
		files,
		manifest,
		runRoot,
		rows,
		decisions,
		inputs: {
			input: { stage: PlanningVocabulary.Stage.Implementation, sources: [], claims: [], confirmations: [] },
			artifacts,
			legacyDecisions: [{ path: 'decisions.json', content: decisions }],
		},
		scope,
	};
};
