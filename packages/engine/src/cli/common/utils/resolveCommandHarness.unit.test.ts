import { expect, test } from '@jest/globals';
import { resolveCommandHarness } from '@/cli/common/utils/resolveCommandHarness';
import type { LightsoutConfig } from '@/contracts';

const base: LightsoutConfig = { gates: { check: 'c', test: 't', 'test-coverage': false } };

test('resolveCommandHarness: no config at all resolves the claude-code default with no model', () => {
	expect(resolveCommandHarness({ config: undefined, command: 'implement' })).toStrictEqual({ driverName: 'claude-code', model: undefined, effort: undefined });
});

test('resolveCommandHarness: globals only — every command resolves the global harness and model', () => {
	const config: LightsoutConfig = { ...base, harness: 'codex', model: 'gpt-5.2' };
	const commands = ['implement', 'refactor', 'improve', 'plan'] as const;

	for (const command of commands) {
		// ${command} falls back to the globals when no commands block exists
		expect(resolveCommandHarness({ config, command })).toStrictEqual({ driverName: 'codex', model: 'gpt-5.2', effort: undefined });
	}
});

test('resolveCommandHarness: an entry overriding both wins for its command; other commands keep the globals', () => {
	const config: LightsoutConfig = { ...base, harness: 'claude-code', model: 'opus', commands: { implement: { harness: 'codex', model: 'gpt-5.2' } } };

	expect(resolveCommandHarness({ config, command: 'implement' })).toStrictEqual({ driverName: 'codex', model: 'gpt-5.2', effort: undefined });
	expect(resolveCommandHarness({ config, command: 'refactor' })).toStrictEqual({ driverName: 'claude-code', model: 'opus', effort: undefined });
});

test("resolveCommandHarness: a harness-only override never inherits the other harness's global model (decision 7)", () => {
	const config: LightsoutConfig = { ...base, model: 'opus', commands: { improve: { harness: 'codex' } } };

	expect(resolveCommandHarness({ config, command: 'improve' })).toStrictEqual({ driverName: 'codex', model: undefined, effort: undefined });
});

test('resolveCommandHarness: a model-only override rides the global harness', () => {
	const config: LightsoutConfig = { ...base, commands: { plan: { model: 'haiku' } } };

	expect(resolveCommandHarness({ config, command: 'plan' })).toStrictEqual({ driverName: 'claude-code', model: 'haiku', effort: undefined });
});

test('resolveCommandHarness: an entry naming the global harness explicitly still inherits the global model', () => {
	const config: LightsoutConfig = { ...base, harness: 'codex', model: 'gpt-5.2', commands: { refactor: { harness: 'codex' } } };

	expect(resolveCommandHarness({ config, command: 'refactor' })).toStrictEqual({ driverName: 'codex', model: 'gpt-5.2', effort: undefined });
});

test('resolveCommandHarness: a global effort resolves for every command when no commands block exists', () => {
	const config: LightsoutConfig = { ...base, effort: 'high' };

	for (const command of ['implement', 'refactor', 'improve', 'plan'] as const) {
		// ${command} inherits the global effort
		expect(resolveCommandHarness({ config, command })).toStrictEqual({ driverName: 'claude-code', model: undefined, effort: 'high' });
	}
});

test('resolveCommandHarness: a per-command effort overrides the global for its command only', () => {
	const config: LightsoutConfig = { ...base, effort: 'medium', commands: { implement: { effort: 'max' } } };

	expect(resolveCommandHarness({ config, command: 'implement' })).toStrictEqual({ driverName: 'claude-code', model: undefined, effort: 'max' });
	// a sibling command keeps the global
	expect(resolveCommandHarness({ config, command: 'refactor' })).toStrictEqual({ driverName: 'claude-code', model: undefined, effort: 'medium' });
});

test('resolveCommandHarness: a harness override inherits the global effort while dropping the global model — the two rules differ on purpose', () => {
	const config: LightsoutConfig = { ...base, model: 'opus', effort: 'xhigh', commands: { improve: { harness: 'codex' } } };

	expect(resolveCommandHarness({ config, command: 'improve' })).toStrictEqual({ driverName: 'codex', model: undefined, effort: 'xhigh' });
});
