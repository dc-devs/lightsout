import type { AgentEnvironment } from '#src/drivers/common/types/AgentEnvironment.ts';
import type { DriverCapabilities } from '#src/drivers/common/types/DriverCapabilities.ts';

interface Params {
	environment: AgentEnvironment;
	capabilities: DriverCapabilities;
}

/**
 * The controls a role asked for that its harness cannot express.
 *
 * Pure: no filesystem, no spawn, no harness introspection — the flag checking
 * happened when the capability record was written, and this only compares two
 * records. The returned names are data for a refusal message, not a vocabulary
 * anything narrows on, which is why they come back as plain strings.
 */
export const getMissingEnvironmentControls = ({ environment, capabilities }: Params): string[] => {
	// A fixed order, so a refusal naming two missing controls reads the same on
	// every run instead of following whichever member order a record happens to
	// have been written in.
	const controls = ['noMcpServers', 'noSkillCatalog', 'toolAllowlist', 'settingsPreserved'] as const;

	return controls.filter((control) => environment[control] && !capabilities[control]);
};
