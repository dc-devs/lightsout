/** Required planning isolation is part of the bound execution policy. */
import type { AgentEnvironment } from '#src/drivers/index.ts';

export const planningRoleEnvironment: AgentEnvironment = { noMcpServers: true, noSkillCatalog: true, toolAllowlist: true, settingsPreserved: true, tools: [] };
