import type {
	CommandCatalogEntry,
	ConfigView,
	FrictionRecord,
	PlanDocument,
	PlanWorkspaceListing,
	PlanWorkspaceView,
	RunListing,
	RunView,
	StandardsPackListing,
	StandardsPackRuleView,
	StandardsPackView,
	StandardsView,
} from '@lightsout/engine';

/**
 * Everything this app knows how to ask for, and the seam a hosted version
 * replaces later.
 *
 * Twelve methods, no more: the first four are this repo's run state, the next
 * three are the standards packs it loads, then the command catalog, then what
 * the repo told lightsout and what fought its agents, and last the plan
 * workspaces that decided the work. One implementation answers them in-process
 * by calling the engine, another from frozen JSON for a build that holds no
 * repo. Nothing above this interface may learn which one it holds — the repo
 * root is app configuration rather than run data, so it is deliberately not a
 * method here.
 */
export interface LightsoutReader {
	listRuns(): Promise<RunListing[]>;
	getRun(params: { runId: string }): Promise<RunView>;
	getStandards(): Promise<StandardsView>;
	getPlan(params: { path: string }): Promise<PlanDocument>;
	listPacks(): Promise<StandardsPackListing[]>;
	getPack(params: { name: string }): Promise<StandardsPackView>;
	getPackRule(params: { name: string; rule: string }): Promise<StandardsPackRuleView>;
	/** The one method that does not depend on where the data lives: the catalog is engine source, identical under either implementation. */
	listCommands(): Promise<CommandCatalogEntry[]>;
	getFriction(): Promise<FrictionRecord[]>;
	getConfig(): Promise<ConfigView>;
	listPlanWorkspaces(): Promise<PlanWorkspaceListing[]>;
	getPlanWorkspace(params: { name: string }): Promise<PlanWorkspaceView>;
}
