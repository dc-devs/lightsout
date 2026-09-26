import type { ConfigView, FrictionRecord, PlanDocument, PlanWorkspaceListing, PlanWorkspaceView, RunListing, RunView, StandardsView } from '@lightsout/engine';

/**
 * Everything this app knows how to ask for, and the seam a hosted version
 * replaces later.
 *
 * Eight methods, no more: the first four are this repo's run state, then what
 * the repo told lightsout and what fought its agents, and last the plan
 * workspaces that decided the work. Nothing the public pages show is here —
 * the command catalog and the standards pack ship with the app, and those pages
 * read them directly rather than asking any repo. The one implementation today
 * answers in-process by calling the engine. Nothing above this interface may
 * learn which one it holds — the repo root is app configuration rather than
 * run data, so it is deliberately not a method here.
 */
export interface LightsoutReader {
	listRuns(): Promise<RunListing[]>;
	getRun(params: { runId: string }): Promise<RunView>;
	getStandards(): Promise<StandardsView>;
	getPlan(params: { path: string }): Promise<PlanDocument>;
	getFriction(): Promise<FrictionRecord[]>;
	getConfig(): Promise<ConfigView>;
	listPlanWorkspaces(): Promise<PlanWorkspaceListing[]>;
	getPlanWorkspace(params: { name: string }): Promise<PlanWorkspaceView>;
}
