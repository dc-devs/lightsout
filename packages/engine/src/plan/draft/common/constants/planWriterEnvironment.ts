import type { AgentEnvironment } from '#src/drivers/index.ts';
import { planWriterTools } from '#src/plan/draft/common/constants/planWriterTools.ts';

/**
 * The focused plan-writer's environment request, composed once.
 *
 * Three of the four properties are asked for positively — no MCP server loaded,
 * no skill or slash-command catalogue loaded, and the built-in tool set
 * restricted to `planWriterTools`. The fourth is expressed by what this record
 * does NOT carry: no model, no effort, no permission level. Those already reach
 * the driver from the config, and a second copy here would be the harness-wide
 * "minimal mode" the focused environment deliberately is not.
 *
 * Both the preflight and every focused spawn read this one value, so a control
 * added to the request cannot reach a spawn without also reaching the preflight
 * that refuses a harness unable to provide it.
 */
export const planWriterEnvironment: AgentEnvironment = {
	noMcpServers: true,
	noSkillCatalog: true,
	toolAllowlist: true,
	settingsPreserved: true,
	tools: planWriterTools,
};
