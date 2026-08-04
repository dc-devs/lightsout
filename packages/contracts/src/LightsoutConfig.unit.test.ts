import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LightsoutConfig } from './index';

const base = { scripts: { check: 'c', testUnit: 't', testCoverage: false } };

test('LightsoutConfig: a stale traverse key parses without error and is stripped from the result', () => {
	const parsed = LightsoutConfig.parse({ ...base, traverse: { connections: 'docs/connections' } });

	assert.equal(LightsoutConfig.safeParse({ ...base, traverse: { connections: 'docs/connections' } }).success, true, 'a leftover traverse block is silently ignored, not an error (decision 4: zod strips unknown keys)');
	assert.equal('traverse' in parsed, false, 'the removed capability leaves no traverse key on the parsed config');
});

test('LightsoutConfig: a commands block parses — full entries, partial entries, and absence all valid', () => {
	const commands = {
		implement: { driver: 'codex', model: 'gpt-5.2' },
		refactor: { driver: 'claude-code', model: 'opus' },
		improve: { driver: 'codex' },
		plan: { model: 'haiku' },
	};

	const parsed = LightsoutConfig.parse({ ...base, commands });

	assert.deepEqual(parsed.commands, commands, 'every entry survives parsing with its driver/model intact — commands is a recognized schema field, not a stripped unknown key like traverse');
	assert.equal(LightsoutConfig.safeParse({ ...base, commands: { implement: { model: 'x' } } }).success, true, 'a partial entry overriding only the model parses');
	assert.equal(LightsoutConfig.safeParse(base).success, true, 'an absent commands block keeps existing configs valid (decision 2: backward compatibility)');
});

test('LightsoutConfig: a typoed command key inside commands fails parsing', () => {
	assert.equal(LightsoutConfig.safeParse({ ...base, commands: { implment: {} } }).success, false, 'a typoed command name is a hard error, not a silently ignored override (decision 8)');
});

test('LightsoutConfig: a typoed field inside a commands entry fails parsing', () => {
	assert.equal(LightsoutConfig.safeParse({ ...base, commands: { implement: { modle: 'x' } } }).success, false, 'a typoed entry field is a hard error, not a silently dropped model (decision 8)');
});
