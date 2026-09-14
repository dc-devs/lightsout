/**
 * The harness-neutral request for a focused agent environment: what a role asks
 * for, stated so that no member names a harness or a flag. Each driver
 * translates it into its own mechanism, and that translation is documented at
 * the driver — never here.
 *
 * The four controls are separate members rather than one all-or-nothing switch
 * because the gap check that reads them has to report WHICH control a harness
 * lacks. The type therefore permits a request for fewer than four; the rule
 * that a focused drafting role requires all four belongs to that role.
 */
export interface AgentEnvironment {
	/** Require that no MCP server is loaded into the spawn. */
	noMcpServers: boolean;
	/** Require that no skill or slash-command catalogue is loaded into the spawn. */
	noSkillCatalog: boolean;
	/** Require the built-in tool set be restricted to `tools`. */
	toolAllowlist: boolean;
	/**
	 * Require that expressing the three above alters neither the harness's own
	 * authentication, nor the configured model, effort or permissions. A
	 * requirement with no positive mechanism: it is satisfied by what a driver
	 * does NOT pass.
	 */
	settingsPreserved: boolean;
	/** Built-in tool names the allowlist admits. Meaningless unless `toolAllowlist` is set. */
	tools: string[];
}
