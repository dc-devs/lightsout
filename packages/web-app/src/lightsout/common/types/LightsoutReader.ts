import type { PlanDocument, RunListing, RunView, StandardsView } from '@lightsout/engine';

/**
 * Everything this app knows how to ask for, and the seam a hosted version
 * replaces later.
 *
 * Four methods, no more: v1 answers them in-process by calling the engine, and
 * the same four get an HTTP implementation when there is a server to call.
 * Nothing above this interface may learn which implementation it holds — the
 * repo root is app configuration rather than run data, so it is deliberately
 * not a method here.
 */
export interface LightsoutReader {
	listRuns(): Promise<RunListing[]>;
	getRun(params: { runId: string }): Promise<RunView>;
	getStandards(): Promise<StandardsView>;
	getPlan(params: { path: string }): Promise<PlanDocument>;
}
