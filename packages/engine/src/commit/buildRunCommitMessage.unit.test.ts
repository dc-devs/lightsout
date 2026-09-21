import { describe, expect, test } from '@jest/globals';
import { buildRunCommitMessage } from '#src/commit/index.ts';

describe('buildRunCommitMessage', () => {
	test('puts the subject first and the run id in the body', () => {
		const message = buildRunCommitMessage({ subject: 'LO-150 001-planning-observability: Planning observability', runId: '20260920-120000-abc123' });

		const [subject, blank, ...body] = message.split('\n');

		expect(subject).toBe('LO-150 001-planning-observability: Planning observability');
		expect(blank).toBe('');
		expect(body.join('\n')).toContain('20260920-120000-abc123');
	});
});
