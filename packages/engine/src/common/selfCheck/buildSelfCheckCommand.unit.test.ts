import { describe, expect, test } from '@jest/globals';
import { buildSelfCheckCommand } from '#src/common/selfCheck/buildSelfCheckCommand.ts';

const setupGrant = ({ cwd = '/my repo', runId = 'run-42' }: { cwd?: string; runId?: string } = {}) => ({
	cwd,
	runId,
});

describe('buildSelfCheckCommand', () => {
	test('buildSelfCheckCommand: grants an unquoted prefix and a command carrying the run id and a quoted working directory', () => {
		const params = setupGrant();

		const { prefix, command } = buildSelfCheckCommand(params);

		// the prefix addresses the running CLI bundle, so the agent's subprocess
		// resolves this engine rather than whatever is installed; the harness
		// matches that prefix literally, so it may carry no quotes and the command
		// must start with exactly it
		expect(prefix).toBe(`node ${process.argv[1]} self-check`);
		expect(prefix).not.toContain('"');
		expect(command.startsWith(prefix)).toBe(true);
		// the run id is the only parameter the command takes; the
		// consumer-controlled path is quoted because it may hold spaces
		expect(command).toBe(`node ${process.argv[1]} self-check --run run-42 --cwd "/my repo"`);
	});
});
