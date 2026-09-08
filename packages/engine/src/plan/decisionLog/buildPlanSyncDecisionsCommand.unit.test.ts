import { describe, expect, test } from '@jest/globals';
import { buildPlanSyncDecisionsCommand } from '#src/plan/decisionLog/buildPlanSyncDecisionsCommand.ts';

describe('buildPlanSyncDecisionsCommand', () => {
	test('buildPlanSyncDecisionsCommand: builds the sync-decisions prefix and quotes the working directory', () => {
		const { prefix, command } = buildPlanSyncDecisionsCommand({
			cwd: '/my repo',
			name: 'add-search',
		});

		// the harness allow-list is a literal prefix match, so the prefix stays
		// unquoted and the command must start with exactly that string
		expect(prefix).toBe(`node ${process.argv[1]} plan sync-decisions`);
		expect(prefix).not.toContain('"');
		expect(command.startsWith(prefix)).toBe(true);
		expect(command).toBe(`node ${process.argv[1]} plan sync-decisions --name add-search --cwd "/my repo"`);
	});
});
