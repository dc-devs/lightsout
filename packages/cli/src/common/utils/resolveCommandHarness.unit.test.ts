import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LightsoutConfig } from '@lightsout/contracts';
import { resolveCommandHarness } from './resolveCommandHarness';

const base: LightsoutConfig = { scripts: { check: 'c', testUnit: 't', testCoverage: false } };

test('resolveCommandHarness: no config at all resolves the claude-code default with no model', () => {
	assert.deepEqual(resolveCommandHarness({ config: undefined, command: 'implement' }), { driverName: 'claude-code', model: undefined, effort: undefined });
});

test('resolveCommandHarness: globals only — every command resolves the global harness and model', () => {
	const config: LightsoutConfig = { ...base, harness: 'codex', model: 'gpt-5.2' };
	const commands = ['implement', 'refactor', 'improve', 'plan'] as const;

	for (const command of commands) {
		assert.deepEqual(resolveCommandHarness({ config, command }), { driverName: 'codex', model: 'gpt-5.2', effort: undefined }, `${command} falls back to the globals when no commands block exists`);
	}
});

test('resolveCommandHarness: an entry overriding both wins for its command; other commands keep the globals', () => {
	const config: LightsoutConfig = { ...base, harness: 'claude-code', model: 'opus', commands: { implement: { harness: 'codex', model: 'gpt-5.2' } } };

	assert.deepEqual(resolveCommandHarness({ config, command: 'implement' }), { driverName: 'codex', model: 'gpt-5.2', effort: undefined });
	assert.deepEqual(resolveCommandHarness({ config, command: 'refactor' }), { driverName: 'claude-code', model: 'opus', effort: undefined });
});

test('resolveCommandHarness: a harness-only override never inherits the other harness\'s global model (decision 7)', () => {
	const config: LightsoutConfig = { ...base, model: 'opus', commands: { improve: { harness: 'codex' } } };

	assert.deepEqual(resolveCommandHarness({ config, command: 'improve' }), { driverName: 'codex', model: undefined, effort: undefined });
});

test('resolveCommandHarness: a model-only override rides the global harness', () => {
	const config: LightsoutConfig = { ...base, commands: { plan: { model: 'haiku' } } };

	assert.deepEqual(resolveCommandHarness({ config, command: 'plan' }), { driverName: 'claude-code', model: 'haiku', effort: undefined });
});

test('resolveCommandHarness: an entry naming the global harness explicitly still inherits the global model', () => {
	const config: LightsoutConfig = { ...base, harness: 'codex', model: 'gpt-5.2', commands: { refactor: { harness: 'codex' } } };

	assert.deepEqual(resolveCommandHarness({ config, command: 'refactor' }), { driverName: 'codex', model: 'gpt-5.2', effort: undefined });
});

test('resolveCommandHarness: a global effort resolves for every command when no commands block exists', () => {
	const config: LightsoutConfig = { ...base, effort: 'high' };

	for (const command of ['implement', 'refactor', 'improve', 'plan'] as const) {
		assert.deepEqual(resolveCommandHarness({ config, command }), { driverName: 'claude-code', model: undefined, effort: 'high' }, `${command} inherits the global effort`);
	}
});

test('resolveCommandHarness: a per-command effort overrides the global for its command only', () => {
	const config: LightsoutConfig = { ...base, effort: 'medium', commands: { implement: { effort: 'max' } } };

	assert.deepEqual(resolveCommandHarness({ config, command: 'implement' }), { driverName: 'claude-code', model: undefined, effort: 'max' });
	assert.deepEqual(resolveCommandHarness({ config, command: 'refactor' }), { driverName: 'claude-code', model: undefined, effort: 'medium' }, 'a sibling command keeps the global');
});

test('resolveCommandHarness: a harness override inherits the global effort while dropping the global model — the two rules differ on purpose', () => {
	const config: LightsoutConfig = { ...base, model: 'opus', effort: 'xhigh', commands: { improve: { harness: 'codex' } } };

	assert.deepEqual(resolveCommandHarness({ config, command: 'improve' }), { driverName: 'codex', model: undefined, effort: 'xhigh' });
});
