import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { type PlanningRoleResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { capturePlanningInput, invokePlanningRole, readPlanningSnapshot } from '#src/plan/index.ts';
import { planningClaimedWorkflowFixture } from '#tests/helpers/planningClaimedWorkflowFixture.ts';
import { planningRoleProposalFixture } from '#tests/helpers/planningRoleProposalFixture.ts';
import { readPlanningWorkflowDiagnostics } from '#tests/helpers/readPlanningWorkflowDiagnostics.ts';

const setup = async ({ variant = 'reuse' }: { variant?: string } = {}) => {
	let cwd = '';
	const fixture = await planningClaimedWorkflowFixture({
		respond: async ({ response, call }) => {
			if (variant === 'provider-throw') throw new Error('Provider transport disconnected');
			if (call > 2) return response;
			if (call === 2 && variant === 'drift') await writeFile(join(cwd, 'sample.ts'), 'export const value = 2;');
			const result: PlanningRoleResult = {
				kind: PlanningVocabulary.ResultKind.EvidenceRequest,
				role: response.role,
				workId: response.workId,
				attemptId: response.attemptId,
				inputDigest: response.inputDigest,
				invocationId: response.invocationId,
				packetDigest: response.packetDigest,
				requests: [
					{
						requestId: 'sample',
						operation: PlanningVocabulary.Operation.ReadFile,
						path: call === 2 && variant === 'conflict' ? 'different.ts' : 'sample.ts',
						reason: 'Read the actual adapter signature.',
					},
				],
			};
			return result;
		},
	});
	cwd = fixture.cwd;
	await writeFile(join(cwd, 'sample.ts'), 'export const value = 1;');
	return fixture;
};

test('reuses an identical evidence request while recording every actual invocation separately', async () => {
	const fixture = await setup();

	const result = await invokePlanningRole(fixture);
	const snapshot = await readPlanningSnapshot(fixture);
	const diagnostics = await readPlanningWorkflowDiagnostics({ root: join(fixture.cwd, '.lightsout', 'plans', fixture.name, '.planning', 'local') });
	const calls = diagnostics.map((text) => JSON.parse(text)).filter((value) => 'callId' in value);

	expect(result.kind).toBe('terminal');
	expect(fixture.calls).toHaveLength(3);
	expect([...(snapshot?.artifacts.keys() ?? [])].filter((path) => path.startsWith('planning-observations/'))).toHaveLength(1);
	expect(new Set(calls.map((call) => call.callId)).size).toBe(3);
	expect(calls.every((call) => call.usage === null)).toBe(true);
	expect(snapshot?.record.work.find((work) => work.id === fixture.work.id)?.status).toBe('running');
});

test.each([
	['conflict', /identity cannot name different operations/],
	['drift', /Evidence changed during the same logical attempt/],
])('rejects inconsistent evidence continuation before another paid invocation: %s', async (variant, message) => {
	const fixture = await setup({ variant: String(variant) });

	await expect(invokePlanningRole(fixture)).rejects.toThrow(message);

	expect(fixture.calls).toHaveLength(2);
	expect((await readPlanningSnapshot(fixture))?.record.work.find((work) => work.id === fixture.work.id)?.resultReceiptId).toBeUndefined();
});

test('persists an actual provider exception without converting it into an accepted result', async () => {
	const fixture = await setup({ variant: 'provider-throw' });

	await expect(invokePlanningRole(fixture)).rejects.toThrow(/Provider transport disconnected/);
	const diagnostics = await readPlanningWorkflowDiagnostics({ root: join(fixture.cwd, '.lightsout', 'plans', fixture.name, '.planning', 'local') });
	const calls = diagnostics.map((text) => JSON.parse(text)).filter((value) => 'callId' in value);

	expect(calls).toHaveLength(1);
	expect(calls[0]).toEqual(expect.objectContaining({ text: 'Provider transport disconnected', exitCode: 1, usage: null }));
	expect((await readPlanningSnapshot(fixture))?.record.work.find((work) => work.id === fixture.work.id)?.resultReceiptId).toBeUndefined();
});

test.each(['codex', 'omp', 'pi'])('refuses unavailable isolation before dispatch for %s', async (name) => {
	const fixture = await planningClaimedWorkflowFixture();
	fixture.runtime.driver = { ...fixture.runtime.driver, name };

	await expect(invokePlanningRole(fixture)).rejects.toThrow(/cannot provide required planning controls/);

	expect(fixture.calls).toHaveLength(0);
});

test('refuses unclaimed work before a provider call', async () => {
	const fixture = await planningClaimedWorkflowFixture();

	await expect(
		invokePlanningRole({ ...fixture, work: { ...fixture.work, status: PlanningVocabulary.WorkState.Pending, currentAttemptId: undefined } }),
	).rejects.toThrow('Planning role requires a claimed attempt');

	expect(fixture.calls).toHaveLength(0);
});

test('requires resolved standards to be committed before a role consumes them', async () => {
	const fixture = await planningClaimedWorkflowFixture();
	fixture.runtime.config = { ...fixture.runtime.config, docs: [] };

	await expect(invokePlanningRole(fixture)).rejects.toThrow(/Resolved standards must be committed/);

	expect(fixture.calls).toHaveLength(0);
});

test('refuses dispatch after new user input retires the supplied attempt', async () => {
	const fixture = await planningClaimedWorkflowFixture();
	const { confirmationId: _approval, ...claim } = fixture.record.claims[0];
	await capturePlanningInput({
		runtime: fixture.runtime,
		input: {
			stage: fixture.runtime.stage,
			sources: [],
			confirmations: [],
			claims: [{ ...claim, id: 'new-user-question', state: PlanningVocabulary.ClaimState.Unresolved }],
		},
	});

	await expect(invokePlanningRole(fixture)).rejects.toThrow(/lost its current attempt/);

	expect(fixture.calls).toHaveLength(0);
});

test('refuses integration dispatch without its complete integration context service', async () => {
	const fixture = await planningRoleProposalFixture({ role: PlanningVocabulary.Role.IntegrationReview });
	const calls = fixture.calls.length;
	fixture.runtime.services.integrationContext = undefined;
	await expect(invokePlanningRole({ runtime: fixture.runtime, snapshot: fixture.before, work: fixture.work })).rejects.toThrow(
		'Planning integration context service is unavailable',
	);
	expect(fixture.calls).toHaveLength(calls);
	expect((await readPlanningSnapshot(fixture))?.record.work.find((work) => work.id === fixture.work.id)?.resultReceiptId).toBeUndefined();
});

test('preserves explicitly delegated harness defaults in the actual invocation rather than inventing execution settings', async () => {
	const fixture = await planningClaimedWorkflowFixture();
	fixture.runtime.model = undefined;
	fixture.runtime.effort = undefined;
	fixture.runtime.permissions = undefined;

	const result = await invokePlanningRole(fixture);

	expect(result.kind).toBe(PlanningVocabulary.ResultKind.Terminal);
	expect(fixture.calls).toHaveLength(1);
	expect(fixture.calls[0]).toEqual(expect.objectContaining({ model: undefined, effort: undefined, permissions: undefined }));
	const snapshot = await readPlanningSnapshot(fixture);
	const invocations = [...(snapshot?.artifacts ?? [])].filter(([path]) => path.startsWith('planning-invocations/')).map(([, text]) => JSON.parse(text));
	expect(invocations).toEqual([expect.objectContaining({ invocationPolicyDigest: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
});
