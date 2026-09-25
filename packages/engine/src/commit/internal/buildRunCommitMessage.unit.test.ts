import { describe, expect, test } from '@jest/globals';
import { buildRunCommitMessage } from '#src/commit/internal/buildRunCommitMessage.ts';

describe('buildRunCommitMessage', () => {
	test('puts the subject first and the run id in the body', () => {
		const message = buildRunCommitMessage({ subject: 'LO-150 001-planning-observability: Planning observability', runId: '20260920-120000-abc123' });

		const [subject, blank, ...body] = message.split('\n');

		expect(subject).toBe('LO-150 001-planning-observability: Planning observability');
		expect(blank).toBe('');
		expect(body.join('\n')).toContain('20260920-120000-abc123');
	});
});

test('buildRunCommitMessage: places the body between the subject and the trailer lines, with the plan line above the run line', () => {
	const message = buildRunCommitMessage({
		subject: 'LO-167: add the widget',
		body: 'The widget reads its size from the config.',
		unit: '001-work-order-state/phase4-queue-ship-worktree',
		runId: '20260923-120000-abc123',
	});

	expect(message).toBe(
		'LO-167: add the widget\n\nThe widget reads its size from the config.\n\nlightsout plan 001-work-order-state/phase4-queue-ship-worktree\nlightsout run 20260923-120000-abc123\n',
	);
});

test.each([
	{ body: ' \n\t ', unit: undefined, expected: 'LO-167: add the widget\n' },
	{ body: undefined, unit: '001-work-order-state', expected: 'LO-167: add the widget\n\nlightsout plan 001-work-order-state\n' },
])('buildRunCommitMessage: leaves out a whitespace-only body and every trailer line it was not given', ({ body, unit, expected }) => {
	const message = buildRunCommitMessage({ subject: 'LO-167: add the widget', body, unit });

	expect(message).toBe(expected);
});
