import { describe, expect, test } from '@jest/globals';
import { buildPlanLintCommand } from '@/plan/common/utils/buildPlanLintCommand';

describe('buildPlanLintCommand', () => {
	test('runs the CLI bundle that is running now, so the writer lints against this engine', () => {
		const { prefix } = buildPlanLintCommand({ cwd: '/repo', name: 'add-search' });

		expect(prefix).toBe(`node ${process.argv[1]} plan lint`);
	});

	test('quotes the consumer path so a directory with a space still resolves', () => {
		const { command } = buildPlanLintCommand({ cwd: '/my repo', name: 'add-search' });

		expect(command).toContain('--cwd "/my repo"');
	});

	test('names no plans directory — the plan folder is derived from cwd and name', () => {
		const { command } = buildPlanLintCommand({ cwd: '/repo', name: 'add-search' });

		// the retired flag must not creep back into the writer's self-lint,
		// got: ${command}
		expect(command).not.toContain('--plans');
		expect(command).toBe(`node ${process.argv[1]} plan lint --name add-search --cwd "/repo"`);
	});

	test('leaves the grant prefix unquoted, because the harness matches it literally', () => {
		const { prefix, command } = buildPlanLintCommand({ cwd: '/my repo', name: 'add-search' });

		// the allowed-tools rule is a plain prefix match, so the command must start
		// with exactly the string the harness was granted
		expect(command.startsWith(prefix)).toBe(true);
		expect(prefix).not.toContain('"');
	});
});
