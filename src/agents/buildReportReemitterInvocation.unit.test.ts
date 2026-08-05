import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReportReemitterInvocation } from '@/agents';

const setupReemitter = ({
	rejectedText = 'Sure! Here is the report:\n\n```json\n{ "status": "complete" }\n```',
	validationError = 'report: Unexpected token in JSON at position 0',
}: { rejectedText?: string; validationError?: string } = {}) => ({ rejectedText, validationError });

test('buildReportReemitterInvocation: the user prompt leads with the re-emitter role prompt', () => {
	const params = setupReemitter();

	const { prompt } = buildReportReemitterInvocation(params);

	assert.ok(prompt.startsWith('# Re-emit your report'), 'the recovery instructions lead the user prompt');
});

test('buildReportReemitterInvocation: the validation error and the rejected message follow, each under its heading, in that order', () => {
	const params = setupReemitter();

	const { prompt } = buildReportReemitterInvocation(params);

	assert.ok(
		prompt.includes(
			`# Validation error\n\n${params.validationError}\n\n# Your previous final message\n\n${params.rejectedText}`,
		),
		'the error the agent must fix comes before the message it must fix',
	);
	assert.ok(prompt.endsWith(params.rejectedText), 'the rejected message closes the prompt');
});

test('buildReportReemitterInvocation: only a user prompt is supplied — the role invocation keeps its own system prompt', () => {
	const params = setupReemitter();

	const invocation = buildReportReemitterInvocation(params);

	assert.deepEqual(Object.keys(invocation), ['prompt'], 'no system prompt is built; the caller reuses the role prompt that carries the contract');
});

test('buildReportReemitterInvocation: the rejected message passes through verbatim, fences and headings intact', () => {
	const params = setupReemitter({
		rejectedText: '# Validation error\n\nI already wrote that heading myself\n\n```json\n{ "status": "failed", "failures": ["boom"] }\n```',
	});

	const { prompt } = buildReportReemitterInvocation(params);

	assert.ok(prompt.includes(params.rejectedText), 'nothing in the rejected text is escaped, trimmed, or truncated');
});

test('buildReportReemitterInvocation: a multi-line validation error keeps every line', () => {
	const params = setupReemitter({
		validationError: 'status: Invalid enum value. Expected "complete" | "failed"\nchangedFiles: Required',
	});

	const { prompt } = buildReportReemitterInvocation(params);

	assert.ok(
		prompt.includes('# Validation error\n\nstatus: Invalid enum value. Expected "complete" | "failed"\nchangedFiles: Required\n\n# Your previous final message'),
		'every zod issue reaches the agent, one per line',
	);
});

test('buildReportReemitterInvocation: both headings survive empty inputs', () => {
	const params = setupReemitter({ rejectedText: '', validationError: '' });

	const { prompt } = buildReportReemitterInvocation(params);

	assert.ok(prompt.endsWith('# Validation error\n\n\n\n# Your previous final message\n\n'), 'an empty error or message leaves its heading in place');
});
