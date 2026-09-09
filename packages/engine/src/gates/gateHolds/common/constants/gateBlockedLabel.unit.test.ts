import { describe, expect, test } from '@jest/globals';
import { gateBlockedLabel } from '#src/gates/gateHolds/common/constants/gateBlockedLabel.ts';

describe('gateBlockedLabel', () => {
	test('is the queue-prefixed blocked label the tracker records', () => {
		// The spelling is the whole contract: one worktree writes this label onto
		// a ticket, a human reads it on the ticket to know why the ticket stopped,
		// and every other worktree matches on it to refuse that ticket. A drift in
		// either half of the name leaves a hold nothing refuses.
		const label = gateBlockedLabel;

		expect(label).toBe('queue-blocked-gate-timed-out');
	});
});
