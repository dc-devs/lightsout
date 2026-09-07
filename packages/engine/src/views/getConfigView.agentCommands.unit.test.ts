import { describe, expect, test } from '@jest/globals';
import type { ConfigView } from '#src/contracts/index.ts';
import { getConfigView } from '#src/views/index.ts';
import { seedConfiguredCwd } from '#tests/helpers/seedConfiguredCwd.ts';

/** One row out of the grouped sections, by the key the file would spell. */
const findField = ({ sections, key }: { sections: ConfigView['sections']; key: string }) =>
	sections.flatMap((section) => section.fields).find((field) => field.key === key);

/** Two prefixes of the shape the key is for — deliverable generators, neither of them a check. */
const grantedPrefixes = ['pnpm build:config-reference', 'pnpm drizzle-kit generate'];

/** A repo whose config either grants command prefixes to its working agents, or deliberately grants none. */
const setupAgentCommands = async ({ agentCommands }: { agentCommands?: string[] } = {}) => {
	const cwd = await seedConfiguredCwd({ config: { ...(agentCommands !== undefined && { 'agent-commands': agentCommands }) } });

	return { cwd };
};

describe('getConfigView', () => {
	test('carries the command prefixes a repo granted its agents onto the page, in the order the file wrote them', async () => {
		const { cwd } = await setupAgentCommands({ agentCommands: grantedPrefixes });

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'agent-commands' })).toEqual(
			expect.objectContaining({ value: ['pnpm build:config-reference', 'pnpm drizzle-kit generate'], fromConfig: true }),
		);
	});

	test('leaves agent-commands null when the file grants none, which is the row that reads "default: none"', async () => {
		const { cwd } = await setupAgentCommands();

		const view = await getConfigView({ cwd });

		expect(findField({ sections: view.sections, key: 'agent-commands' })).toEqual(expect.objectContaining({ value: null, fromConfig: false }));
	});

	test('keeps saying on the agent-commands row that a repo never grants a verification command here', async () => {
		const { cwd } = await setupAgentCommands({ agentCommands: grantedPrefixes });

		const view = await getConfigView({ cwd });

		// the sentence is the one the config reference document is rendered from, so
		// the page and that document cannot say different things about the key
		expect(findField({ sections: view.sections, key: 'agent-commands' })?.description).toEqual(
			expect.stringContaining('Verification commands never belong here'),
		);
	});

	test("names the engine's own self-check as the one verification command an agent is handed, granted per spawn rather than configured here", async () => {
		const { cwd } = await setupAgentCommands({ agentCommands: grantedPrefixes });

		const view = await getConfigView({ cwd });

		// a reader who saw only "verification commands never belong here" would read
		// the self-check in an agent's task as a repo that broke the rule; the row
		// says whose command it is and where the grant comes from
		expect(findField({ sections: view.sections, key: 'agent-commands' })?.description).toEqual(expect.stringMatching(/self-check[\s\S]*granted per spawn/));
	});

	test('gives agent-commands an area of its own, holding that key and nothing else', async () => {
		const { cwd } = await setupAgentCommands({ agentCommands: grantedPrefixes });

		const view = await getConfigView({ cwd });

		expect(view.sections.find((section) => section.title === 'Agent commands')?.fields.map((field) => field.key)).toStrictEqual(['agent-commands']);
	});
});
