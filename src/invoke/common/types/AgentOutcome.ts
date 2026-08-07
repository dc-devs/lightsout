import type { AgentUsage } from '@/contracts';

/**
 * What one agent invocation produced: a report that satisfied its contract, or
 * the reason there is none.
 *
 * A union rather than a bag of optional fields, because the two states are not
 * independent — an invocation that returns no report ALWAYS knows why. Modelled
 * loosely, every caller had to write `failure ?? 'unknown failure'` against a
 * state the engine never produces, and eight of them did. Narrowing on `ok`
 * makes the reason a plain string wherever it is actually needed.
 *
 * Usage rides on both arms: a failed attempt still burns tokens, and a run that
 * did not account for them would under-report what it cost.
 */
export type AgentOutcome<Report> =
	| { ok: true; report: Report; usage?: AgentUsage }
	| {
			ok: false;
			failure: string;
			/** The harness hit its subscription limit — the caller parks rather than fails. */
			rateLimited: boolean;
			usage?: AgentUsage;
	  };
