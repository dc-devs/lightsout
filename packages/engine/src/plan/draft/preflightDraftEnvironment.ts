import { type AgentEnvironment, type Driver, getDriverCapabilities, getMissingEnvironmentControls } from '#src/drivers/index.ts';

interface Params {
	driver: Driver;
	environment: AgentEnvironment;
}

/** What each requested control means to a human reading a refusal, rather than the member name the records compare on. */
const controlWording: Record<string, string> = {
	noMcpServers: 'excluding every MCP server from the spawn',
	noSkillCatalog: 'keeping the skill and slash-command catalogue out of the spawn',
	toolAllowlist: 'restricting the built-in tool set to a named allowlist',
	settingsPreserved: 'expressing the above without altering its authentication, model, effort or permissions',
};

/**
 * Refuse a focused draft before any agent is spawned when the resolved harness
 * cannot provide an environment control the role asked for.
 *
 * The capability record is read by `driver.name` — the same key `getDriver`
 * registers under — and compared against the request, so this spends nothing and
 * introspects no harness: the flag checking happened when the capability record
 * was written.
 *
 * The message names the harness and every control it cannot provide rather than
 * only the first, then says the one thing that actually resolves it: configure a
 * harness that can express them. It offers no retry, no downgrade and no second
 * authoring implementation, because there is none — a message hinting at a
 * fallback teaches the reader to wait for one that will never come, and
 * substituting a harness or dropping a requested control on their behalf would
 * spend an agent in an environment they did not ask for.
 *
 * @returns undefined when the harness can provide every requested control, otherwise the refusal message
 */
export const preflightDraftEnvironment = ({ driver, environment }: Params): string | undefined => {
	const missing = getMissingEnvironmentControls({ environment, capabilities: getDriverCapabilities({ name: driver.name }) });

	if (missing.length === 0) {
		return undefined;
	}

	const reasons = missing.map((control) => `  - ${control}: ${controlWording[control] ?? control}`).join('\n');

	return [
		`the ${driver.name} harness cannot provide the focused drafting environment, so this draft was refused before any agent was spawned.`,
		'',
		'Missing control(s):',
		reasons,
		'',
		'Configure a harness that can provide them under `commands.plan` or `harness` in lightsout.config.json, then run the draft again.',
	].join('\n');
};
