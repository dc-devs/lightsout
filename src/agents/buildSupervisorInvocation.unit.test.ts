import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildSupervisorInvocation } from '@/agents';

interface SetupParams {
	/** The plan the failing step belongs to — sentinel-marked so leakage into the cached prefix shows. */
	planContent?: string;
	stepId?: string;
	/** The verification-gate output that keeps failing. */
	errorOutput?: string;
	attempts?: number;
}

const setupConsultation = ({
	planContent = '# Plan: add the widget flag\n\nPLAN-SENTINEL',
	stepId = 'implement:widget',
	errorOutput = 'tsc --noEmit failed\n\nERROR-SENTINEL',
	attempts = 3,
}: SetupParams = {}) => ({ planContent, stepId, errorOutput, attempts });

describe('buildSupervisorInvocation', () => {
	test('the system prompt is the supervisor role prompt, carrying the verdict contract', () => {
		const { systemPrompt } = buildSupervisorInvocation(setupConsultation());

		assert.ok(systemPrompt.startsWith('# Role: Pipeline Supervisor'), 'the role prompt leads the system prompt');
		assert.ok(systemPrompt.includes('"decision": "retry" | "escalate"'), 'the verdict schema the engine parses is in the prompt');
	});

	test('the system prompt is byte-identical across consultations, whatever the failure', () => {
		const first = buildSupervisorInvocation(setupConsultation());
		const later = buildSupervisorInvocation(
			setupConsultation({
				planContent: '# Plan: something else entirely',
				stepId: 'test:unit',
				errorOutput: 'a different gate, a different failure',
				attempts: 9,
			}),
		);

		assert.equal(first.systemPrompt, later.systemPrompt, 'only the user prompt varies between consultations, so the cached prefix holds');
	});

	test('the user prompt is the failing step, the gate output, the plan, and the report reminder in that order', () => {
		const { prompt } = buildSupervisorInvocation(setupConsultation());

		assert.equal(
			prompt,
			'# Failing step\n\n`implement:widget` — 3 attempt(s) so far, mechanical retries exhausted.\n\n' +
				'# Verification output\n\ntsc --noEmit failed\n\nERROR-SENTINEL\n\n' +
				'# Plan\n\n# Plan: add the widget flag\n\nPLAN-SENTINEL\n\n' +
				'Remember: your entire final message must be exactly one JSON verdict object — nothing else.',
		);
	});

	test('the failing-step header names the step and its attempt count', () => {
		const { prompt } = buildSupervisorInvocation(setupConsultation({ stepId: 'gates:check', attempts: 1 }));

		assert.ok(prompt.startsWith('# Failing step\n\n`gates:check` — 1 attempt(s) so far'), 'the step id and attempt count lead the prompt');
	});

	test('an empty gate output still renders its section, so the supervisor sees the gate produced nothing', () => {
		const { prompt } = buildSupervisorInvocation(setupConsultation({ errorOutput: '' }));

		assert.ok(prompt.includes('# Verification output\n\n\n\n# Plan'), 'the empty section is kept, not collapsed away');
	});

	test('neither the plan nor the gate output leaks into the cached system prompt', () => {
		const { systemPrompt } = buildSupervisorInvocation(setupConsultation());

		assert.ok(!systemPrompt.includes('PLAN-SENTINEL'), 'the plan is paid for once, in the user prompt');
		assert.ok(!systemPrompt.includes('ERROR-SENTINEL'), 'the gate output is paid for once, in the user prompt');
	});
});
