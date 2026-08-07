import { expect, describe, test } from '@jest/globals';
import { buildPlanLintCommand } from '@/plan/common/utils/buildPlanLintCommand';

describe('buildPlanLintCommand', () => {
	test('runs the CLI bundle that is running now, so the writer lints against this engine', () => {
		const { prefix } = buildPlanLintCommand({ cwd: '/repo', name: 'add-search', plansDir: '/repo/.claude/plans' });

		expect(prefix).toBe(`node ${process.argv[1]} plan lint`);
	});

	test('quotes the consumer paths so a directory with a space still resolves', () => {
		const { command } = buildPlanLintCommand({ cwd: '/my repo', name: 'add-search', plansDir: '/my repo/.claude/plans' });

		expect(command).toContain('--plans "/my repo/.claude/plans"');
		expect(command).toContain('--cwd "/my repo"');
	});

	test('leaves the grant prefix unquoted, because the harness matches it literally', () => {
		const { prefix, command } = buildPlanLintCommand({ cwd: '/my repo', name: 'add-search', plansDir: '/my repo/.claude/plans' });

		// the allowed-tools rule is a plain prefix match, so the command must start
		// with exactly the string the harness was granted
		expect(command.startsWith(prefix)).toBe(true);
		expect(prefix).not.toContain('"');
	});
});
