import type {
	CommandCatalogEntry,
	ConfigView,
	FrictionRecord,
	PlanDocument,
	PlanWorkspaceListing,
	PlanWorkspaceView,
	RunListing,
	RunView,
	StandardsView,
} from '@lightsout/engine';

/**
 * Everything this app knows how to ask for, and the seam a hosted version
 * replaces later.
 *
 * Nine methods, no more: the first four are this repo's run state, then the
 * command catalog, then what the repo told lightsout and what fought its
 * agents, and last the plan workspaces that decided the work. The standards
 * pack the public pages document is not here: it ships with the app, and those
 * pages read it directly rather than asking any repo. One implementation answers them in-process
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
	/** The one method that does not depend on where the data lives: the catalog is engine source, identical under either implementation. */
	listCommands(): Promise<CommandCatalogEntry[]>;
	getFriction(): Promise<FrictionRecord[]>;
	getConfig(): Promise<ConfigView>;
	listPlanWorkspaces(): Promise<PlanWorkspaceListing[]>;
	getPlanWorkspace(params: { name: string }): Promise<PlanWorkspaceView>;
}
