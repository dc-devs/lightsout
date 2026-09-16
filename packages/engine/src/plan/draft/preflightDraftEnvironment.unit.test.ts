import { expect, test } from '@jest/globals';
import type { AgentEnvironment, Driver } from '#src/drivers/index.ts';
import { preflightDraftEnvironment } from '#src/plan/draft/preflightDraftEnvironment.ts';

// The preflight reads a harness's capability record by driver name, so the
// driver here carries a real harness name and a spawn that is never reached —
// a refusal that spawns anything would be the failure this check exists to
// prevent.
const setupPreflight = ({ name }: { name: string }) => {
	const driver: Driver = {
		name,
		invoke: async () => ({ text: '', exitCode: 0 }),
	};
	const environment: AgentEnvironment = {
		noMcpServers: true,
		noSkillCatalog: true,
		toolAllowlist: true,
		settingsPreserved: true,
		tools: ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'],
	};

	return { driver, environment };
};

test('passes a harness that declares every requested control', () => {
	const { driver, environment } = setupPreflight({ name: 'claude-code' });

	const refusal = preflightDraftEnvironment({ driver, environment });

	expect(refusal).toBeUndefined();
});

test('names every missing control and the one remedy that exists, offering no fallback', () => {
	// pi declares the tool allowlist and leaves the harness's own settings
	// alone, but can express neither MCP exclusion nor skill exclusion — two
	// missing controls, so a message naming only the first is a failure.
	const { driver, environment } = setupPreflight({ name: 'pi' });

	const refusal = preflightDraftEnvironment({ driver, environment });

	// The refusal is human-facing copy, so each claim is matched loosely: the
	// harness it resolved, both controls it cannot provide, and the configuration
	// change that resolves it.
	expect(refusal).toEqual(expect.stringMatching(/\bpi\b/));
	expect(refusal).toEqual(expect.stringMatching(/mcp/i));
	expect(refusal).toEqual(expect.stringMatching(/skill/i));
	expect(refusal).toEqual(expect.stringMatching(/harness/i));
	// there is no second authoring implementation to fall back to, so nothing may
	// read as though waiting or retrying would produce one
	expect(refusal).not.toEqual(expect.stringMatching(/--legacy|fall ?back|retry|try again with/i));
});
