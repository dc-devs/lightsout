import { expect, test } from '@jest/globals';
import type { AgentEnvironment } from '#src/drivers/common/types/AgentEnvironment.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
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

test('names every missing control and the legacy escape in one refusal', () => {
	// pi declares the tool allowlist and leaves the harness's own settings
	// alone, but can express neither MCP exclusion nor skill exclusion — two
	// missing controls, so a message naming only the first is a failure.
	const { driver, environment } = setupPreflight({ name: 'pi' });

	const refusal = preflightDraftEnvironment({ driver, environment });

	// The refusal is human-facing copy, so each claim is matched loosely: the
	// harness it resolved, both controls it cannot provide, and the flag that
	// reaches the legacy implementation instead.
	expect(refusal).toEqual(expect.stringMatching(/\bpi\b/));
	expect(refusal).toEqual(expect.stringMatching(/mcp/i));
	expect(refusal).toEqual(expect.stringMatching(/skill/i));
	expect(refusal).toEqual(expect.stringMatching(/--legacy/));
});
