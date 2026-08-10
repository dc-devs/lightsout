import { describe, expect, test } from '@jest/globals';
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

		// the role prompt leads the system prompt
		expect(systemPrompt.startsWith('# Role: Pipeline Supervisor')).toBeTruthy();
		// the verdict schema the engine parses is in the prompt
		expect(systemPrompt.includes('"decision": "retry" | "escalate"')).toBeTruthy();
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

		// only the user prompt varies between consultations, so the cached prefix
		// holds
		expect(first.systemPrompt).toBe(later.systemPrompt);
	});

	test('the user prompt is the failing step, the gate output, the plan, and the report reminder in that order', () => {
		const { prompt } = buildSupervisorInvocation(setupConsultation());

		expect(prompt).toBe(
			'# Failing step\n\n`implement:widget` — 3 attempt(s) so far, mechanical retries exhausted.\n\n' +
				'# Verification output\n\ntsc --noEmit failed\n\nERROR-SENTINEL\n\n' +
				'# Plan\n\n# Plan: add the widget flag\n\nPLAN-SENTINEL\n\n' +
				'Remember: your entire final message must be exactly one JSON verdict object — nothing else.',
		);
	});

	test('the failing-step header names the step and its attempt count', () => {
		const { prompt } = buildSupervisorInvocation(setupConsultation({ stepId: 'gates:check', attempts: 1 }));

		// the step id and attempt count lead the prompt
		expect(prompt.startsWith('# Failing step\n\n`gates:check` — 1 attempt(s) so far')).toBeTruthy();
	});

	test('an empty gate output still renders its section, so the supervisor sees the gate produced nothing', () => {
		const { prompt } = buildSupervisorInvocation(setupConsultation({ errorOutput: '' }));

		// the empty section is kept, not collapsed away
		expect(prompt.includes('# Verification output\n\n\n\n# Plan')).toBeTruthy();
	});

	test('neither the plan nor the gate output leaks into the cached system prompt', () => {
		const { systemPrompt } = buildSupervisorInvocation(setupConsultation());

		// the plan is paid for once, in the user prompt
		expect(systemPrompt.includes('PLAN-SENTINEL')).toBeFalsy();
		// the gate output is paid for once, in the user prompt
		expect(systemPrompt.includes('ERROR-SENTINEL')).toBeFalsy();
	});
});
