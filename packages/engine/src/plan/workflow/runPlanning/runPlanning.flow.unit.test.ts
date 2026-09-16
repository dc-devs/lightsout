import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { resolveConfigAndDriver } from '#src/cli/common/utils/resolveConfigAndDriver.ts';
import { parseFlags, planCommand } from '#src/cli/index.ts';
import { getCommandCatalogEntry } from '#src/commands/index.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import {
	type PlanningAnswer,
	type PlanningClaim,
	type PlanningOrigin,
	type PlanningRoleResult,
	PlanningRunResult,
	type PlanningScope,
	PlanningVocabulary,
} from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import {
	answerPlanningQuestion,
	capturePlanningInput,
	createPlanningRuntime,
	exportPlanningGeneration,
	inspectPlanningCompletion,
	installPlanningGeneration,
	PlanningMode,
	type PlanningSnapshot,
	preparePlanningHandoff,
	readHandoffSources,
	readPlanningSnapshot,
	runPlanning,
} from '#src/plan/index.ts';
import { PlanningProposalApproval } from '#src/plan/workflow/common/types/questions/PlanningProposalApproval.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';
import { planningQuestionAnswer } from '#tests/helpers/planningWorkflowQuestionScenario.ts';
import { planningWorkflowFinding } from '#tests/helpers/planningWorkflowScenarios.ts';

// Mocked Imports
// -------------------------
const mockResolveConfigAndDriver = jest.fn<typeof resolveConfigAndDriver>();

jest.mock('#src/cli/common/utils/resolveConfigAndDriver.ts', () => ({
	resolveConfigAndDriver: (params: Parameters<typeof resolveConfigAndDriver>[0]) => mockResolveConfigAndDriver(params),
}));
// -------------------------

const standardsPack = {
	'house/lightsout-standards.json': '{"name":"house","formatVersion":1}',
	'house/code/base/document.md': '# Code standards\nPreserve completed uploads.',
	'house/tests/base/document.md': '# Test standards\nProve retry retention at the public boundary.',
};

const acceptanceClaim = ({ origin, scope, dependencies }: { origin: PlanningOrigin; scope: PlanningScope; dependencies: string[] }): PlanningClaim => ({
	id: 'retry-acceptance',
	kind: PlanningVocabulary.ClaimKind.Acceptance,
	text: 'Verify the approved retry behavior.',
	explanation: 'Exercise completion preservation after retry failure.',
	contentRevision: 1,
	origin,
	owner: PlanningVocabulary.Owner.Planner,
	state: PlanningVocabulary.ClaimState.Settled,
	dependencies,
	scope,
	acceptance: {
		kind: PlanningVocabulary.Acceptance.Test,
		criterion: 'A failed retry retains completed uploads.',
		testFile: 'src/retryUpload.unit.test.ts',
		testName: 'retains completed uploads after retry failure',
		gate: 'test',
	},
});

const productConflictClaim = ({ origin, scope }: { origin: PlanningOrigin; scope: PlanningScope }): PlanningClaim => ({
	id: 'retention-question',
	kind: PlanningVocabulary.ClaimKind.Question,
	text: 'May a retry delete a completed upload?',
	explanation: 'The ticket suggests deletion, contradicting the confirmed preservation requirement.',
	contentRevision: 1,
	origin,
	owner: PlanningVocabulary.Owner.User,
	state: PlanningVocabulary.ClaimState.Unresolved,
	dependencies: ['required'],
	scope,
	question: {
		context: 'Completed uploads are currently preserved. The ticket suggests deleting them on retry, which would lose user work.',
		question: 'Should completed uploads be retained on retry?',
		options: [
			{ label: 'Retain uploads', description: 'Keep the approved preservation behavior.' },
			{ label: 'Delete uploads', description: 'Replace the approved behavior and require re-uploading.' },
		],
		recommendation: 'Retain uploads',
	},
});

/**
 * Every settled obligation the acceptance claim must trace back to.
 *
 * A plan that reached implementation through brainstorm carries the design and
 * decision claims that stage settled, and each of them is a binding obligation
 * the exact acceptance criterion has to cover. Naming only the architecture
 * claim this very response emits would leave the aligned design uncovered,
 * which is exactly the omission the engine refuses to call ready.
 */
const settledObligationIds = ({ snapshot }: { snapshot: PlanningSnapshot }) =>
	snapshot.record.claims
		.filter(
			(claim) =>
				claim.state !== PlanningVocabulary.ClaimState.Superseded &&
				claim.kind !== PlanningVocabulary.ClaimKind.Acceptance &&
				claim.kind !== PlanningVocabulary.ClaimKind.Question,
		)
		.map((claim) => claim.id);

/** Where the strict answer document is written, exactly as `plan answer --answer-file` reads it. */
const answerFile = '.lightsout/answer.json';

/** Approve the exact proposal the engine presented, against the revision and digest it was presented at. */
const approveProposal = ({
	proposal,
	delegation,
}: {
	proposal: Extract<PlanningRunResult, { status: 'awaiting-user' }>;
	delegation: PlanningAnswer['confirmation']['delegation'];
}): PlanningAnswer => {
	const selectedOption = proposal.question.options[0]?.label;
	if (!selectedOption) throw new Error('A proposal checkpoint must offer an explicit approval option');
	return {
		questionId: proposal.questionId,
		questionDigest: proposal.questionDigest,
		checkpointRevision: proposal.checkpointRevision,
		selectedOption,
		confirmation: {
			// Each checkpoint is approved by its own message: the engine refuses an
			// earlier approval replayed against a later question, which is the point.
			id: `foreground-approval:${proposal.questionId}`,
			channel: PlanningVocabulary.ConfirmationChannel.Foreground,
			messageId: `user-message:${proposal.questionId}`,
			messageText: selectedOption,
			approvedDigest: sha256({ content: selectedOption }),
			delegation,
		},
	};
};

/** The proposal approvals the generation actually holds, in the order the user gave them. */
const recordedApprovals = ({ snapshot }: { snapshot: PlanningSnapshot }) =>
	[...snapshot.artifacts]
		.filter(([path]) => path.startsWith('planning-proposal-approvals/'))
		.map(([, text]) => PlanningProposalApproval.parse(JSON.parse(text)))
		.sort((left, right) => left.checkpointRevision - right.checkpointRevision)
		.map((approval) => ({
			questionId: approval.questionId,
			questionDigest: approval.questionDigest,
			confirmationId: approval.confirmation.id,
		}));

/** Carry the brainstorm-aligned design into implementation, adding the exact acceptance obligation and one technical failure scenario. */
const implementationDriver = ({ inner, current, scope }: { inner: Driver; current: () => Promise<PlanningSnapshot>; scope: PlanningScope }): Driver => {
	let challenged = false;
	return {
		name: inner.name,
		invoke: async (invocation) => {
			const result = await inner.invoke(invocation);
			if (result.exitCode !== 0) return result;
			const response = JSON.parse(result.text) as PlanningRoleResult;
			if (response.kind !== PlanningVocabulary.ResultKind.Terminal) return result;
			if (response.role === PlanningVocabulary.Role.Architect) {
				const snapshot = await current();
				const origin = snapshot.record.sources[0];
				if (!origin) throw new Error('Implementation architecture must inherit the preserved original source');
				const acceptance = acceptanceClaim({
					origin,
					scope,
					dependencies: [...settledObligationIds({ snapshot }), 'upload-architecture'],
				});
				const carried: PlanningRoleResult = {
					...response,
					claims: [...response.claims, acceptance],
					artifactLayouts: response.artifactLayouts?.map((layout) => ({ ...layout, claimIds: [...layout.claimIds, acceptance.id] })),
				};
				return { ...result, text: JSON.stringify(carried) };
			}
			if (response.role === PlanningVocabulary.Role.ImplementationReview && 'coverage' in response && !challenged) {
				challenged = true;
				const pressed: PlanningRoleResult = {
					...response,
					findings: [planningWorkflowFinding({ id: 'retry-identity', scope })],
					coverage: { ...response.coverage, outcome: PlanningVocabulary.Review.Insufficient },
				};
				return { ...result, text: JSON.stringify(pressed) };
			}
			return result;
		},
	};
};

const setupFullFlow = async () => {
	const fixture = await planningReviewFixture({ stage: PlanningVocabulary.Stage.Brainstorm });
	for (const [path, text] of Object.entries(standardsPack)) {
		await mkdir(join(fixture.cwd, path, '..'), { recursive: true });
		await writeFile(join(fixture.cwd, path), text);
	}
	const config = { ...fixture.runtime.config, 'standards-packs': ['house'], 'auto-plan': { 'auto-approve-plan': true } };
	const shared = { cwd: fixture.cwd, name: fixture.name, config, mode: PlanningMode.Automatic };
	const brainstorm = await createPlanningRuntime({ ...shared, driver: fixture.runtime.driver, stage: PlanningVocabulary.Stage.Brainstorm });
	const implementation = await createPlanningRuntime({
		...shared,
		driver: implementationDriver({ inner: fixture.runtime.driver, current: fixture.current, scope: fixture.scope }),
		stage: PlanningVocabulary.Stage.Implementation,
	});
	Object.assign(fixture.runtime, brainstorm);
	const plan = join('.lightsout/plans', fixture.name, 'plan.md');
	return { ...fixture, config, implementation, plan };
};

const setupDefaults = async () => {
	const fixture = await planningReviewFixture({
		respond: ({ response, snapshot }) => {
			if (response.kind !== PlanningVocabulary.ResultKind.Terminal) return response;
			// The user's settled answer lands as a binding decision claim after the
			// architecture is already written, so repair is where the exact acceptance
			// criterion is linked back over it — the repair the finding actually asks for.
			if (response.role === PlanningVocabulary.Role.Repair) {
				const acceptance = snapshot.record.claims.find((claim) => claim.kind === PlanningVocabulary.ClaimKind.Acceptance);
				if (!acceptance) return response;
				return {
					...response,
					claims: [{ ...acceptance, contentRevision: acceptance.contentRevision + 1, dependencies: settledObligationIds({ snapshot }) }],
				};
			}
			if (response.role !== PlanningVocabulary.Role.Architect) return response;
			const origin = snapshot.record.sources[0];
			const claim = snapshot.record.claims[0];
			if (!origin || !claim) throw new Error('A genuine product conflict requires captured original intent');
			return { ...response, claims: [...response.claims, productConflictClaim({ origin, scope: claim.scope })] };
		},
	});
	const output = captureCommandOutput();
	const config = { ...fixture.runtime.config, 'auto-plan': { 'auto-approve-plan': false, 'propose-before-draft': true } };
	mockResolveConfigAndDriver.mockResolvedValue({ config, driver: fixture.runtime.driver });
	await mkdir(join(fixture.cwd, '.lightsout'), { recursive: true });
	await writeFile(join(fixture.cwd, '.lightsout/input.json'), JSON.stringify(fixture.input));
	// Dispatched through the one public `plan` command, exactly as the CLI does,
	// with isolation off so the session stays in the fixture's own checkout.
	const dispatch = ({ subcommand, args }: { subcommand: string; args: string[] }) =>
		planCommand({ cwd: fixture.cwd, rest: [subcommand], flags: parseFlags({ args: [...args, '--no-worktree'] }) });
	const run = (args: string[]) => dispatch({ subcommand: 'run', args });
	const reply = async ({ answer, args }: { answer: unknown; args: string[] }) => {
		await writeFile(join(fixture.cwd, answerFile), JSON.stringify(answer));
		return dispatch({ subcommand: 'answer', args });
	};
	const latest = () => PlanningRunResult.parse(JSON.parse(output.logged.at(-1) ?? 'null'));
	return { ...fixture, ...output, config, run, reply, latest };
};

describe('runPlanning', () => {
	test('preserves full intent through brainstorm planning and fresh execution', async () => {
		const fixture = await setupFullFlow();

		const checkpoint = await fixture.run();
		if (checkpoint.status !== 'awaiting-user') throw new Error(`Expected an independently challenged design checkpoint: ${JSON.stringify(checkpoint)}`);
		const aligned = await answerPlanningQuestion({
			runtime: fixture.runtime,
			answer: planningQuestionAnswer({ result: checkpoint, delegation: fixture.scope, alignment: true }),
		});
		const planned = await runPlanning({ runtime: fixture.implementation });
		const snapshot = await readPlanningSnapshot(fixture);
		expectDefined(snapshot);
		const text = exportPlanningGeneration({ snapshot }).get('planning-record.json');
		expectDefined(text);
		const cwd = await freshCwd();
		const directory = join(cwd, '.lightsout/plans', fixture.name);
		await mkdir(directory, { recursive: true });
		const restored = await installPlanningGeneration({ directory, name: fixture.name, text, expectedDigest: sha256({ content: text }) });
		const handoff = await preparePlanningHandoff({ cwd: fixture.cwd, config: fixture.config, plan: fixture.plan });
		expectDefined(handoff);
		const sources = await readHandoffSources({ cwd, handoff, plan: fixture.plan });

		expect(aligned).toEqual(expect.objectContaining({ status: 'aligned', confirmationId: 'foreground-design-approval' }));
		expect(snapshot.record.confirmations.filter((confirmation) => confirmation.id === 'foreground-design-approval')).toHaveLength(1);
		expect(planned).toEqual(expect.objectContaining({ status: 'complete', readiness: expect.objectContaining({ ready: true, target: 'implementation' }) }));
		expect(snapshot.record.reviewReceipts.some((receipt) => receipt.role === 'design-review' && receipt.coverage.outcome === 'adequate')).toBe(true);
		expect(snapshot.record.reviewReceipts.some((receipt) => receipt.role === 'integration-review' && receipt.coverage.outcome === 'adequate')).toBe(true);
		expect(snapshot.record.findings.find((finding) => finding.missingObligation === 'Preserve retry identity for retry-identity')).toEqual(
			expect.objectContaining({ state: 'verified', verificationReceiptIds: expect.arrayContaining([expect.any(String)]) }),
		);
		expect(snapshot.record.work.some((work) => work.role === 'repair' && work.status === 'complete')).toBe(true);
		expect(restored.digest).toBe(snapshot.digest);
		expect(sources.contract.claims.map((claim) => claim.origin.text)).toContain('Preserve completed uploads');
		expect(sources.contract.standards.some((standard) => standard.text.includes('Prove retry retention at the public boundary'))).toBe(true);
		expect(
			sources.contract.acceptance.map((claim) => (claim.kind === 'acceptance' && claim.acceptance.kind === 'test' ? claim.acceptance.testName : '')),
		).toContain('retains completed uploads after retry failure');
		expect(sources.contract.predecessorReceiptIds).toEqual([]);
		expect(sources.planContent).toContain('Preserve completed uploads');

		const omitted = 'Also preserve upload metadata whenever a retry fails.';
		const origin = { artifact: 'metadata.md', locator: 'Requirement', text: omitted, sha256: sha256({ content: omitted }) };
		const original = fixture.input.claims[0];
		expectDefined(original);
		await capturePlanningInput({
			runtime: fixture.implementation,
			input: {
				stage: PlanningVocabulary.Stage.Implementation,
				sources: [...fixture.input.sources, origin],
				claims: [
					...fixture.input.claims,
					{ ...original, id: 'metadata-retention', text: omitted, origin, state: PlanningVocabulary.ClaimState.Unresolved, confirmationId: undefined },
				],
				confirmations: fixture.input.confirmations,
			},
		});
		const incomplete = await readPlanningSnapshot(fixture);
		expectDefined(incomplete);
		const readiness = await inspectPlanningCompletion({
			cwd: fixture.cwd,
			config: fixture.config,
			snapshot: incomplete,
			stage: PlanningVocabulary.Stage.Implementation,
		});

		expect(readiness.ready).toBe(false);
		await expect(preparePlanningHandoff({ cwd: fixture.cwd, config: fixture.config, plan: fixture.plan })).rejects.toThrow('revalidation');
	}, 180_000);

	test('uses replacement defaults without reopening settled product decisions', async () => {
		const fixture = await setupDefaults();
		const catalog = getCommandCatalogEntry({ id: 'plan' });
		expectDefined(catalog);

		await expect(fixture.run(['--name', fixture.name, '--input-file', '.lightsout/input.json'])).rejects.toThrow('process.exit');
		const conflict = fixture.latest();
		if (conflict.status !== 'awaiting-user') throw new Error(`Expected the genuinely new product decision: ${JSON.stringify(conflict)}`);
		const decision = planningQuestionAnswer({ result: conflict, delegation: fixture.scope });
		await expect(fixture.reply({ answer: decision, args: ['--name', fixture.name, '--answer-file', answerFile] })).rejects.toThrow('process.exit');
		const proposal = fixture.latest();
		if (proposal.status !== 'awaiting-user') throw new Error(`Expected the configured proposal checkpoint: ${JSON.stringify(proposal)}`);
		await expect(
			fixture.reply({ answer: approveProposal({ proposal, delegation: fixture.scope }), args: ['--name', fixture.name, '--answer-file', answerFile] }),
		).rejects.toThrow('process.exit');
		const planApproval = fixture.latest();
		if (planApproval.status !== 'awaiting-user') throw new Error(`Expected the configured plan-approval checkpoint: ${JSON.stringify(planApproval)}`);
		await expect(
			fixture.reply({
				answer: approveProposal({ proposal: planApproval, delegation: fixture.scope }),
				args: ['--name', fixture.name, '--answer-file', answerFile],
			}),
		).rejects.toThrow('process.exit');
		const settled = await readPlanningSnapshot(fixture);
		expectDefined(settled);
		const calls = fixture.calls.length;
		await expect(fixture.run(['--name', fixture.name, '--mode', 'automatic'])).rejects.toThrow('process.exit');
		const repeated = fixture.latest();

		expect(conflict.question).toEqual(
			expect.objectContaining({
				context: expect.stringContaining('Completed uploads'),
				options: expect.arrayContaining([expect.objectContaining({ label: 'Retain uploads', description: expect.any(String) })]),
				recommendation: 'Retain uploads',
			}),
		);
		expect(proposal.questionId).toBe('proposal:before-draft');
		expect(planApproval.questionId).toBe('proposal:after-ready');
		expect(settled.record.claims).toContainEqual(
			expect.objectContaining({ kind: 'decision', owner: 'user', state: 'settled', text: decision.freeText, confirmationId: decision.confirmation.id }),
		);
		expect(settled.record.confirmations.filter((confirmation) => confirmation.id === decision.confirmation.id)).toHaveLength(1);
		// Both configured checkpoints are still enforced, each recorded against the
		// exact question the user saw rather than approved in the abstract.
		expect(recordedApprovals({ snapshot: settled })).toEqual([
			{ questionId: 'proposal:before-draft', questionDigest: proposal.questionDigest, confirmationId: 'foreground-approval:proposal:before-draft' },
			{ questionId: 'proposal:after-ready', questionDigest: planApproval.questionDigest, confirmationId: 'foreground-approval:proposal:after-ready' },
		]);
		expect(repeated.status).toBe('complete');
		expect(fixture.exitCodes).toEqual([2, 2, 2, 0, 0]);
		expect(fixture.calls).toHaveLength(calls);
		expect(fixture.calls.every((call) => call.prompt.includes('"role":'))).toBe(true);
		expect(mockResolveConfigAndDriver).toHaveBeenCalledWith({ cwd: fixture.cwd, command: 'plan' });
		expect(catalog.invocations.map((invocation) => invocation.positional)).toEqual(expect.arrayContaining(['run', 'answer']));
		expect(catalog.flags.map((flag) => flag.name)).toEqual(expect.arrayContaining(['name', 'stage', 'mode', 'input-file', 'answer-file']));
		expect(catalog.flags.find((flag) => flag.name === 'stage')?.fallback).toContain('implementation');
		expect(catalog.flags.find((flag) => flag.name === 'mode')?.fallback).toContain('interactive');
		expect(catalog.flags.some((flag) => flag.name === 'legacy')).toBe(false);
		expect(catalog.flags.some((flag) => /budget|cutoff|max-round/i.test(`${flag.name} ${flag.meaning} ${flag.fallback ?? ''}`))).toBe(false);
	}, 180_000);
});
