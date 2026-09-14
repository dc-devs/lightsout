/**
 * What one harness's verified flag surface can express, as data — one record
 * per harness the engine can spawn.
 *
 * Deliberately kept separate from `AgentEnvironment` even though four member
 * names coincide: the two records answer different questions — what a role asks
 * for versus what a harness can do — and one shared shape would let a
 * capability record be passed where a request belongs with the compiler silent.
 * The duplicated names are what make the comparison between them readable.
 */
export interface DriverCapabilities {
	/** The harness this record answers for. Equal to the `Driver.name` of the same harness. */
	name: string;
	/** The harness can exclude every MCP server from a spawn. */
	noMcpServers: boolean;
	/** The harness can keep the skill and slash-command catalogue out of a spawn. */
	noSkillCatalog: boolean;
	/** The harness can restrict the built-in tool set to a named allowlist. */
	toolAllowlist: boolean;
	/** The harness expresses the three above without altering its own authentication, or the configured model, effort or permissions. */
	settingsPreserved: boolean;
}
