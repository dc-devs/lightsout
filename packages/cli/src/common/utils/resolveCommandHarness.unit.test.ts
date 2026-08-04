import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LightsoutConfig } from '@lightsout/contracts';
import { resolveCommandHarness } from './resolveCommandHarness';

const base: LightsoutConfig = { scripts: { check: 'c', testUnit: 't', testCoverage: false } };

test('resolveCommandHarness: no config at all resolves the claude-code default with no model', () => {
	assert.deepEqual(resolveCommandHarness({ config: undefined, command: 'implement' }), { driverName: 'claude-code', model: undefined });
});

test('resolveCommandHarness: globals only — every command resolves the global driver and model', () => {
	const config: LightsoutConfig = { ...base, driver: 'codex', model: 'gpt-5.2' };
	const commands = ['implement', 'refactor', 'improve', 'plan'] as const;

	for (const command of commands) {
		assert.deepEqual(resolveCommandHarness({ config, command }), { driverName: 'codex', model: 'gpt-5.2' }, `${command} falls back to the globals when no commands block exists`);
	}
});

test('resolveCommandHarness: an entry overriding both wins for its command; other commands keep the globals', () => {
	const config: LightsoutConfig = { ...base, driver: 'claude-code', model: 'opus', commands: { implement: { driver: 'codex', model: 'gpt-5.2' } } };

	assert.deepEqual(resolveCommandHarness({ config, command: 'implement' }), { driverName: 'codex', model: 'gpt-5.2' });
	assert.deepEqual(resolveCommandHarness({ config, command: 'refactor' }), { driverName: 'claude-code', model: 'opus' });
});

test('resolveCommandHarness: a driver-only override never inherits the other harness\'s global model (decision 7)', () => {
	const config: LightsoutConfig = { ...base, model: 'opus', commands: { improve: { driver: 'codex' } } };

	assert.deepEqual(resolveCommandHarness({ config, command: 'improve' }), { driverName: 'codex', model: undefined });
});

test('resolveCommandHarness: a model-only override rides the global driver', () => {
	const config: LightsoutConfig = { ...base, commands: { plan: { model: 'haiku' } } };

	assert.deepEqual(resolveCommandHarness({ config, command: 'plan' }), { driverName: 'claude-code', model: 'haiku' });
});

test('resolveCommandHarness: an entry naming the global driver explicitly still inherits the global model', () => {
	const config: LightsoutConfig = { ...base, driver: 'codex', model: 'gpt-5.2', commands: { refactor: { driver: 'codex' } } };

	assert.deepEqual(resolveCommandHarness({ config, command: 'refactor' }), { driverName: 'codex', model: 'gpt-5.2' });
});
