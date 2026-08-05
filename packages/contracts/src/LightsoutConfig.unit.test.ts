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
		implement: { harness: 'codex', model: 'gpt-5.2' },
		refactor: { harness: 'claude-code', model: 'opus' },
		improve: { harness: 'codex' },
		plan: { model: 'haiku' },
	};

	const parsed = LightsoutConfig.parse({ ...base, commands });

	assert.deepEqual(parsed.commands, commands, 'every entry survives parsing with its harness/model intact — commands is a recognized schema field, not a stripped unknown key like traverse');
	assert.equal(LightsoutConfig.safeParse({ ...base, commands: { implement: { model: 'x' } } }).success, true, 'a partial entry overriding only the model parses');
	assert.equal(LightsoutConfig.safeParse(base).success, true, 'an absent commands block keeps existing configs valid (decision 2: backward compatibility)');
});

test('LightsoutConfig: effort parses at the top level and inside a commands entry, for every level', () => {
	for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
		assert.equal(LightsoutConfig.parse({ ...base, effort }).effort, effort, `${effort} is one of the five levels every harness shares`);
		assert.equal(
			LightsoutConfig.parse({ ...base, commands: { implement: { effort } } }).commands?.implement?.effort,
			effort,
			`${effort} parses inside a commands entry too`,
		);
	}

	assert.equal(LightsoutConfig.safeParse(base).success, true, 'effort stays optional — absence means each harness uses its own default');
});

test('LightsoutConfig: an out-of-enum effort fails parsing at both levels', () => {
	assert.equal(LightsoutConfig.safeParse({ ...base, effort: 'ultra' }).success, false, 'a typo is caught when config is read, not after a run has burned a request');
	assert.equal(LightsoutConfig.safeParse({ ...base, commands: { implement: { effort: 'ultra' } } }).success, false, 'the per-command enum is the same closed set');
});

test('LightsoutConfig: permissions accepts the two settable levels and rejects everything else', () => {
	assert.equal(LightsoutConfig.parse({ ...base, permissions: 'write' }).permissions, 'write');
	assert.equal(LightsoutConfig.parse({ ...base, permissions: 'full-access' }).permissions, 'full-access');

	assert.equal(LightsoutConfig.safeParse({ ...base, permissions: 'read-only' }).success, false, 'read-only is engine-selected for the supervisor — never a sane choice for a writing role');

	for (const claudeMode of ['acceptEdits', 'bypassPermissions', 'plan']) {
		assert.equal(LightsoutConfig.safeParse({ ...base, permissions: claudeMode }).success, false, `${claudeMode} is Claude Code's own vocabulary — it used to parse as a free string and now does not`);
	}
});

test('LightsoutConfig: the removed driver and permissionMode keys are refused with a message naming their replacement', () => {
	const driverResult = LightsoutConfig.safeParse({ ...base, driver: 'codex' });
	const permissionModeResult = LightsoutConfig.safeParse({ ...base, permissionMode: 'bypassPermissions' });

	assert.equal(driverResult.success, false, 'the top level is not strict, so a stale key must be refused explicitly or it would be silently discarded');
	assert.match(driverResult.error?.message ?? '', /renamed to `harness`/, 'the message is the whole point of the rejection');

	assert.equal(permissionModeResult.success, false);
	assert.match(permissionModeResult.error?.message ?? '', /replaced by `permissions`/);
});

test('LightsoutConfig: a stale driver inside a commands entry is a hard parse error too', () => {
	assert.equal(
		LightsoutConfig.safeParse({ ...base, commands: { implement: { driver: 'codex' } } }).success,
		false,
		'the strict block makes the rename fail loudly in both halves of the surface',
	);
});

test('LightsoutConfig: permissions is global only — a commands entry may not carry it', () => {
	assert.equal(
		LightsoutConfig.safeParse({ ...base, permissions: 'full-access', commands: { implement: { harness: 'codex' } } }).success,
		true,
		'the global level applies to every command; a command entry still overrides harness/model/effort',
	);
	assert.equal(
		LightsoutConfig.safeParse({ ...base, commands: { implement: { permissions: 'full-access' } } }).success,
		false,
		'permissions expresses a repo-wide trust posture (decision 13) — the strict block refuses it per command rather than silently ignoring it',
	);
	assert.equal(
		LightsoutConfig.safeParse({ ...base, commands: { implement: { permissionMode: 'bypassPermissions' } } }).success,
		false,
		'the removed name is refused inside a commands entry too, so the replacement fails loudly in both halves of the surface',
	);
});

test('LightsoutConfig: a config carrying neither removed key still parses clean', () => {
	const parsed = LightsoutConfig.parse({ ...base, harness: 'codex', model: 'gpt-5.2', effort: 'high', permissions: 'write' });

	assert.equal(parsed.harness, 'codex', 'the rejections must not fire on absence');
	assert.equal('driver' in parsed, false);
	assert.equal('permissionMode' in parsed, false);
});

test('LightsoutConfig: a typoed command key inside commands fails parsing', () => {
	assert.equal(LightsoutConfig.safeParse({ ...base, commands: { implment: {} } }).success, false, 'a typoed command name is a hard error, not a silently ignored override (decision 8)');
});

test('LightsoutConfig: a typoed field inside a commands entry fails parsing', () => {
	assert.equal(LightsoutConfig.safeParse({ ...base, commands: { implement: { modle: 'x' } } }).success, false, 'a typoed entry field is a hard error, not a silently dropped model (decision 8)');
});

test('LightsoutConfig: standards and testStandards accept folder, file, and token entries in one array, in config order', () => {
	const standards = ['standards/code', 'docs/our-extra-rules.md', 'lightsout:code-defaults'];
	const testStandards = ['standards/tests', 'lightsout:test-defaults'];

	const parsed = LightsoutConfig.parse({ ...base, standards, testStandards });

	assert.deepEqual(parsed.standards, standards, 'a folder entry is a plain string entry alongside files and tokens — the schema carries no path-kind discrimination that would reject it');
	assert.deepEqual(parsed.testStandards, testStandards, 'testStandards accepts the same entry shapes, with entry order preserved for in-place expansion');
});

test('LightsoutConfig: standards and testStandards accept false and absence', () => {
	const parsed = LightsoutConfig.parse({ ...base, standards: false, testStandards: false });

	assert.equal(parsed.standards, false, 'false is the explicit opt-out, distinct from an absent field');
	assert.equal(parsed.testStandards, false, 'testStandards opts out the same way');
	assert.equal(LightsoutConfig.safeParse(base).success, true, 'both fields stay optional — an absent field means the bundled defaults load');
});

test('LightsoutConfig: a non-string standards entry fails parsing', () => {
	assert.equal(LightsoutConfig.safeParse({ ...base, standards: [{ path: 'standards/code' }] }).success, false, 'entries are plain strings — an object entry is a hard error, pinning that folder support added no structured entry form');
	assert.equal(LightsoutConfig.safeParse({ ...base, testStandards: 'standards/tests' }).success, false, 'a bare string in place of the array is a hard error');
});
