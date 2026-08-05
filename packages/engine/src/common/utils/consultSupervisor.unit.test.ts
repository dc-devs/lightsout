import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LightsoutConfig } from '@lightsout/contracts';
import type { Driver, DriverInvocation } from '@lightsout/drivers';
import { consultSupervisor } from './consultSupervisor';
import { verdict } from '../../../tests/helpers/verdict';

/**
 * A stub harness recording every invocation it receives, plus the minimum
 * config the supervisor reads (`scripts` is required by the contract but never
 * consulted here). Overrides carry the model/effort/permissions/timeouts under
 * test.
 */
const setupSupervisor = ({ overrides = {}, text = verdict() }: { overrides?: Partial<LightsoutConfig>; text?: string } = {}) => {
	const invocations: DriverInvocation[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			return { text, exitCode: 0 };
		},
	};

	const config: LightsoutConfig = {
		scripts: { check: 'true', testUnit: 'true', testCoverage: 'true' },
		...overrides,
	};

	return {
		invocations,
		args: {
			driver,
			cwd: '/repo',
			config,
			planContent: 'PLAN-CONTENT',
			stepId: 'implement',
			errorOutput: 'GATE-OUTPUT',
			attempts: 3,
		},
	};
};

test('consult supervisor: the harness is invoked read-only, whatever the config permits', async () => {
	const { invocations, args } = setupSupervisor({ overrides: { permissions: 'full-access' } });

	const result = await consultSupervisor(args);

	assert.equal(result.failure, undefined);
	assert.equal(invocations.length, 1);
	assert.equal(invocations[0].permissions, 'read-only', "the supervisor's posture is engine-owned — config never widens it");
});

test('consult supervisor: a config without permissions still invokes read-only', async () => {
	const { invocations, args } = setupSupervisor();

	await consultSupervisor(args);

	assert.equal(invocations[0].permissions, 'read-only');
});

test('consult supervisor: the configured effort rides along to the harness', async () => {
	const { invocations, args } = setupSupervisor({ overrides: { effort: 'xhigh' } });

	await consultSupervisor(args);

	assert.equal(invocations[0].effort, 'xhigh');
});

test('consult supervisor: no configured effort leaves the harness on its own default', async () => {
	const { invocations, args } = setupSupervisor();

	await consultSupervisor(args);

	assert.equal(invocations[0].effort, undefined, 'an absent effort is forwarded as absent, never defaulted by the engine');
});

test('consult supervisor: the configured model rides along to the harness', async () => {
	const { invocations, args } = setupSupervisor({ overrides: { model: 'stub-model-1' } });

	await consultSupervisor(args);

	assert.equal(invocations[0].model, 'stub-model-1');
});

test('consult supervisor: an unset supervisor timeout falls back to fifteen minutes', async () => {
	const { invocations, args } = setupSupervisor();

	await consultSupervisor(args);

	assert.equal(invocations[0].timeoutMs, 900_000);
});

test('consult supervisor: a configured supervisorMinutes sets the invocation ceiling', async () => {
	const { invocations, args } = setupSupervisor({ overrides: { timeouts: { agentMinutes: 90, supervisorMinutes: 5 } } });

	await consultSupervisor(args);

	assert.equal(invocations[0].timeoutMs, 300_000);
});

test('consult supervisor: the failing step, gate output, and plan reach the supervisor prompt', async () => {
	const { invocations, args } = setupSupervisor();

	await consultSupervisor(args);

	const { prompt, cwd, systemPrompt } = invocations[0];

	assert.ok(prompt.includes('`implement` — 3 attempt(s) so far'), `the failing step and attempt count ride the prompt, got: ${prompt}`);
	assert.ok(prompt.includes('GATE-OUTPUT'), 'the verification output rides the prompt');
	assert.ok(prompt.includes('PLAN-CONTENT'), "the plan rides the prompt as the supervisor's context");
	assert.ok(systemPrompt, 'the supervisor role prompt is the system prompt');
	assert.equal(cwd, '/repo');
});

test('consult supervisor: a contract-valid verdict comes back parsed for the caller to act on', async () => {
	const { args } = setupSupervisor({ text: verdict({ decision: 'retry', diagnosis: 'stale artifact', guidance: 'delete BROKEN' }) });

	const result = await consultSupervisor(args);

	assert.equal(result.failure, undefined);
	assert.deepEqual(result.report, { decision: 'retry', diagnosis: 'stale artifact', guidance: 'delete BROKEN' });
});

test('consult supervisor: a verdict that never matches the contract fails instead of returning a report', async () => {
	const { args } = setupSupervisor({ text: 'the run looks broken to me' });

	const result = await consultSupervisor(args);

	assert.equal(result.report, undefined);
	assert.match(result.failure ?? '', /did not match contract/);
});
