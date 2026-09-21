import { describe, expect, test } from '@jest/globals';
import type { RunStatus } from '#src/contracts/index.ts';
import { type AgentOutcome, getAgentOutcomeStatus } from '#src/invoke/index.ts';

/** One settled agent call, carrying only the two fields the reading turns on. */
const setupOutcome = ({ ok, rateLimited = false }: { ok: boolean; rateLimited?: boolean }): { outcome: AgentOutcome<unknown> } => ({
	outcome: ok ? { ok: true, report: { drafted: true } } : { ok: false, failure: 'the harness answered off contract', rateLimited },
});

describe('getAgentOutcomeStatus', () => {
	test.each<{ settled: string; ok: boolean; rateLimited?: boolean; status: RunStatus }>([
		{ settled: 'answered on contract', ok: true, status: 'passed' },
		// the wall is a resumable state, not an error — a step closed as failed
		// would tell a human to diagnose a run that only has to be re-run later
		{ settled: 'met the rate-limit wall', ok: false, rateLimited: true, status: 'paused-rate-limit' },
		{ settled: 'failed for any other reason', ok: false, rateLimited: false, status: 'failed' },
	])('a call that $settled closes its level as $status', ({ ok, rateLimited, status }) => {
		const { outcome } = setupOutcome({ ok, rateLimited });

		const closed = getAgentOutcomeStatus({ outcome });

		expect(closed).toBe(status);
	});
});
