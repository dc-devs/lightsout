import { expect, test } from '@jest/globals';
import type { AgentEnvironment, DriverCapabilities } from '#src/drivers/index.ts';
import { getMissingEnvironmentControls } from '#src/drivers/index.ts';

const setupControls = ({
	requires = {},
	declares = {},
	tools = ['Read', 'Grep', 'Bash'],
}: {
	requires?: Partial<Omit<AgentEnvironment, 'tools'>>;
	declares?: Partial<Omit<DriverCapabilities, 'name'>>;
	tools?: string[];
} = {}) => {
	const environment: AgentEnvironment = {
		noMcpServers: false,
		noSkillCatalog: false,
		toolAllowlist: false,
		settingsPreserved: false,
		...requires,
		tools,
	};
	const capabilities: DriverCapabilities = {
		name: 'claude-code',
		noMcpServers: false,
		noSkillCatalog: false,
		toolAllowlist: false,
		settingsPreserved: false,
		...declares,
	};

	return { environment, capabilities };
};

test('getMissingEnvironmentControls: a harness declaring every requested control is missing none', () => {
	const { environment, capabilities } = setupControls({
		requires: { noMcpServers: true, noSkillCatalog: true, toolAllowlist: true, settingsPreserved: true },
		declares: { noMcpServers: true, noSkillCatalog: true, toolAllowlist: true, settingsPreserved: true },
	});

	const missing = getMissingEnvironmentControls({ environment, capabilities });

	expect(missing).toStrictEqual([]);
});

test('getMissingEnvironmentControls: every unmet control is reported, in the declared order', () => {
	const { environment, capabilities } = setupControls({
		requires: { noMcpServers: true, noSkillCatalog: true, toolAllowlist: true, settingsPreserved: true },
		declares: { noMcpServers: false, noSkillCatalog: true, toolAllowlist: false, settingsPreserved: true },
	});

	const missing = getMissingEnvironmentControls({ environment, capabilities });

	expect(missing).toStrictEqual(['noMcpServers', 'toolAllowlist']);
});

test('getMissingEnvironmentControls: a control the request does not require is never reported', () => {
	const { environment, capabilities } = setupControls({
		requires: { noSkillCatalog: true, settingsPreserved: true },
		declares: { noSkillCatalog: true, settingsPreserved: true },
	});

	const missing = getMissingEnvironmentControls({ environment, capabilities });

	expect(missing).toStrictEqual([]);
});

// A capability record whose members are written in the reverse of the control
// order, so an implementation reading its order off the record — rather than
// off its own fixed list — reports the missing controls backwards.
const setupReversedCapabilities = () => {
	const environment: AgentEnvironment = {
		noMcpServers: true,
		noSkillCatalog: true,
		toolAllowlist: true,
		settingsPreserved: true,
		tools: ['Read', 'Grep', 'Bash'],
	};
	const capabilities: DriverCapabilities = {
		settingsPreserved: true,
		toolAllowlist: false,
		noSkillCatalog: true,
		noMcpServers: false,
		name: 'omp',
	};

	return { environment, capabilities };
};

test('getMissingEnvironmentControls: the reported order comes from the control order, not the record’s member order', () => {
	const { environment, capabilities } = setupReversedCapabilities();

	const missing = getMissingEnvironmentControls({ environment, capabilities });

	expect(missing).toStrictEqual(['noMcpServers', 'toolAllowlist']);
});
