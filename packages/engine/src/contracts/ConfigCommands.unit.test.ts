import { expect, test } from '@jest/globals';
import { ConfigCommands } from '@/contracts';

test('ConfigCommands: full entries and partial entries both parse with their fields intact', () => {
	const commands = {
		implement: { harness: 'codex', model: 'gpt-5.2' },
		refactor: { harness: 'claude-code', model: 'opus' },
		improve: { harness: 'codex' },
		plan: { model: 'haiku' },
	};

	// every entry survives parsing with its harness/model intact
	expect(ConfigCommands.parse(commands)).toStrictEqual(commands);
	// a partial entry overriding only the model parses
	expect(ConfigCommands.safeParse({ implement: { model: 'x' } }).success).toBe(true);
});

test('ConfigCommands: effort parses inside an entry for every level, and an out-of-enum effort fails', () => {
	for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
		// ${effort} is one of the five levels every harness shares
		expect(ConfigCommands.parse({ implement: { effort } }).implement?.effort).toBe(effort);
	}

	// a typo is caught when config is read, not after a run has burned a request
	expect(ConfigCommands.safeParse({ implement: { effort: 'ultra' } }).success).toBe(false);
});

test('ConfigCommands: a stale driver inside an entry is a hard parse error', () => {
	// the strict block makes the rename fail loudly in the per-command half of the surface
	expect(ConfigCommands.safeParse({ implement: { driver: 'codex' } }).success).toBe(false);
});

test('ConfigCommands: an entry may not carry permissions, under either name', () => {
	// permissions expresses a repo-wide trust posture (decision 13) — the strict
	// block refuses it per command rather than silently ignoring it
	expect(ConfigCommands.safeParse({ implement: { permissions: 'full-access' } }).success).toBe(false);
	// the removed name is refused inside an entry too, so the replacement fails loudly
	expect(ConfigCommands.safeParse({ implement: { permissionMode: 'bypassPermissions' } }).success).toBe(false);
});

test('ConfigCommands: a typoed command key fails parsing', () => {
	// a typoed command name is a hard error, not a silently ignored override (decision 8)
	expect(ConfigCommands.safeParse({ implment: {} }).success).toBe(false);
});

test('ConfigCommands: the coverage command has its own entry, and a typo near it is still refused', () => {
	const parsed = ConfigCommands.parse({ 'test-coverage-to-threshold': { harness: 'codex', effort: 'high' } });

	// the coverage run is a long unattended loop — it earns a harness of its own
	expect(parsed['test-coverage-to-threshold']).toStrictEqual({ harness: 'codex', effort: 'high' });
	// the strict block means a near-miss disables an override the user believes
	// is active, so it fails loudly instead
	expect(ConfigCommands.safeParse({ 'test-coverage': {} }).success).toBe(false);
});

test('ConfigCommands: a typoed field inside an entry fails parsing', () => {
	// a typoed entry field is a hard error, not a silently dropped model (decision 8)
	expect(ConfigCommands.safeParse({ implement: { modle: 'x' } }).success).toBe(false);
});
