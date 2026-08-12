import { expect, test } from '@jest/globals';
import { outcomeFields } from '@tests/helpers/outcomeFields';
import { verdict } from '@tests/helpers/verdict';
import { consultSupervisor } from '@/common/utils/consultSupervisor';
import type { LightsoutConfig } from '@/contracts';
import type { Driver, DriverInvocation } from '@/drivers';

/**
 * A stub harness recording every invocation it receives, plus the minimum
 * config the supervisor reads (`scripts` is required by the contract but never
 * consulted here). Overrides carry the model/effort/permissions/timeouts under
 * test.
 */
const setupSupervisor = ({ overrides = {}, text = verdict() }: { overrides?: Partial<LightsoutConfig>; text?: string } = {}) => {
	const invocations: DriverInvocation[] = [];
	const events: unknown[] = [];
	const rejected: Array<{ text: string; attempt: number; validationError: string }> = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);
			invocation.onEvent?.({ type: 'stub-stream-event' });

			return { text, exitCode: 0 };
		},
	};

	const config: LightsoutConfig = {
		gates: { check: 'true', test: 'true', testCoverage: 'true' },
		...overrides,
	};

	return {
		invocations,
		events,
		rejected,
		args: {
			driver,
			cwd: '/repo',
			config,
			planContent: 'PLAN-CONTENT',
			stepId: 'implement',
			errorOutput: 'GATE-OUTPUT',
			attempts: 3,
			onEvent: (event: unknown) => {
				events.push(event);
			},
			onRejectedOutput: (entry: { text: string; attempt: number; validationError: string }) => {
				rejected.push(entry);
			},
		},
	};
};

test('consult supervisor: the harness is invoked read-only, whatever the config permits', async () => {
	const { invocations, args } = setupSupervisor({ overrides: { permissions: 'full-access' } });

	const result = outcomeFields(await consultSupervisor(args));

	expect(result.failure).toBe(undefined);
	expect(invocations.length).toBe(1);
	// the supervisor's posture is engine-owned — config never widens it
	expect(invocations[0].permissions).toBe('read-only');
});

test('consult supervisor: a config without permissions still invokes read-only', async () => {
	const { invocations, args } = setupSupervisor();

	await consultSupervisor(args);

	expect(invocations[0].permissions).toBe('read-only');
});

test('consult supervisor: the configured effort rides along to the harness', async () => {
	const { invocations, args } = setupSupervisor({ overrides: { effort: 'xhigh' } });

	await consultSupervisor(args);

	expect(invocations[0].effort).toBe('xhigh');
});

test('consult supervisor: no configured effort leaves the harness on its own default', async () => {
	const { invocations, args } = setupSupervisor();

	await consultSupervisor(args);

	// an absent effort is forwarded as absent, never defaulted by the engine
	expect(invocations[0].effort).toBe(undefined);
});

test('consult supervisor: the configured model rides along to the harness', async () => {
	const { invocations, args } = setupSupervisor({ overrides: { model: 'stub-model-1' } });

	await consultSupervisor(args);

	expect(invocations[0].model).toBe('stub-model-1');
});

test('consult supervisor: an unset supervisor timeout falls back to fifteen minutes', async () => {
	const { invocations, args } = setupSupervisor();

	await consultSupervisor(args);

	expect(invocations[0].timeoutMs).toBe(900_000);
});

test('consult supervisor: a configured supervisorMinutes sets the invocation ceiling', async () => {
	const { invocations, args } = setupSupervisor({ overrides: { timeouts: { agentMinutes: 90, supervisorMinutes: 5 } } });

	await consultSupervisor(args);

	expect(invocations[0].timeoutMs).toBe(300_000);
});

test('consult supervisor: the failing step, gate output, and plan reach the supervisor prompt', async () => {
	const { invocations, args } = setupSupervisor();

	await consultSupervisor(args);

	const { prompt, cwd, systemPrompt } = invocations[0];

	// the failing step and attempt count ride the prompt, got: ${prompt}
	expect(prompt.includes('`implement` — 3 attempt(s) so far')).toBeTruthy();
	// the verification output rides the prompt
	expect(prompt.includes('GATE-OUTPUT')).toBeTruthy();
	// the plan rides the prompt as the supervisor's context
	expect(prompt.includes('PLAN-CONTENT')).toBeTruthy();
	// the supervisor role prompt is the system prompt
	expect(systemPrompt).toBeTruthy();
	expect(cwd).toBe('/repo');
});

test('consult supervisor: a contract-valid verdict comes back parsed for the caller to act on', async () => {
	const { args } = setupSupervisor({ text: verdict({ decision: 'retry', diagnosis: 'stale artifact', guidance: 'delete BROKEN' }) });

	const result = outcomeFields(await consultSupervisor(args));

	expect(result.failure).toBe(undefined);
	expect(result.report).toStrictEqual({ decision: 'retry', diagnosis: 'stale artifact', guidance: 'delete BROKEN' });
});

test('consult supervisor: a verdict that never matches the contract fails instead of returning a report', async () => {
	const { args } = setupSupervisor({ text: 'the run looks broken to me' });

	const result = outcomeFields(await consultSupervisor(args));

	expect(result.report).toBe(undefined);
	expect(result.failure ?? '').toMatch(/did not match contract/);
});

test('consult supervisor: every contract-rejected message reaches the caller, attempt by attempt, as run evidence', async () => {
	const { rejected, args } = setupSupervisor({ text: 'the run looks broken to me' });

	await consultSupervisor(args);

	// the caller persists the raw text of both the first try and the re-emit retry
	expect(rejected.map(({ text, attempt }) => ({ text, attempt }))).toStrictEqual([
		{ text: 'the run looks broken to me', attempt: 1 },
		{ text: 'the run looks broken to me', attempt: 2 },
	]);
});

test("consult supervisor: the caller's stream listener reaches the harness", async () => {
	const { events, args } = setupSupervisor();

	await consultSupervisor(args);

	// harness events flow back to the caller untouched
	expect(events).toStrictEqual([{ type: 'stub-stream-event' }]);
});
