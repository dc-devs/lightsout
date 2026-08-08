import { expect, test } from '@jest/globals';
import { LightsoutConfig } from '@/contracts';

const base = { scripts: { check: 'c', testUnit: 't', testCoverage: false } };

test('LightsoutConfig: a stale traverse key parses without error and is stripped from the result', () => {
	const parsed = LightsoutConfig.parse({ ...base, traverse: { connections: 'docs/connections' } });

	// a leftover traverse block is silently ignored, not an error (decision 4: zod
	// strips unknown keys)
	expect(LightsoutConfig.safeParse({ ...base, traverse: { connections: 'docs/connections' } }).success).toBe(true);
	// the removed capability leaves no traverse key on the parsed config
	expect('traverse' in parsed).toBe(false);
});

test('LightsoutConfig: a commands block parses — full entries, partial entries, and absence all valid', () => {
	const commands = {
		implement: { harness: 'codex', model: 'gpt-5.2' },
		refactor: { harness: 'claude-code', model: 'opus' },
		improve: { harness: 'codex' },
		plan: { model: 'haiku' },
	};

	const parsed = LightsoutConfig.parse({ ...base, commands });

	// every entry survives parsing with its harness/model intact — commands is a
	// recognized schema field, not a stripped unknown key like traverse
	expect(parsed.commands).toStrictEqual(commands);
	// a partial entry overriding only the model parses
	expect(LightsoutConfig.safeParse({ ...base, commands: { implement: { model: 'x' } } }).success).toBe(true);
	// an absent commands block keeps existing configs valid (decision 2: backward
	// compatibility)
	expect(LightsoutConfig.safeParse(base).success).toBe(true);
});

test('LightsoutConfig: effort parses at the top level and inside a commands entry, for every level', () => {
	for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
		// ${effort} is one of the five levels every harness shares
		expect(LightsoutConfig.parse({ ...base, effort }).effort).toBe(effort);
		// ${effort} parses inside a commands entry too
		expect(LightsoutConfig.parse({ ...base, commands: { implement: { effort } } }).commands?.implement?.effort).toBe(effort);
	}

	// effort stays optional — absence means each harness uses its own default
	expect(LightsoutConfig.safeParse(base).success).toBe(true);
});

test('LightsoutConfig: an out-of-enum effort fails parsing at both levels', () => {
	// a typo is caught when config is read, not after a run has burned a request
	expect(LightsoutConfig.safeParse({ ...base, effort: 'ultra' }).success).toBe(false);
	// the per-command enum is the same closed set
	expect(LightsoutConfig.safeParse({ ...base, commands: { implement: { effort: 'ultra' } } }).success).toBe(false);
});

test('LightsoutConfig: permissions accepts the two settable levels and rejects everything else', () => {
	expect(LightsoutConfig.parse({ ...base, permissions: 'write' }).permissions).toBe('write');
	expect(LightsoutConfig.parse({ ...base, permissions: 'full-access' }).permissions).toBe('full-access');

	// read-only is engine-selected for the supervisor — never a sane choice for a
	// writing role
	expect(LightsoutConfig.safeParse({ ...base, permissions: 'read-only' }).success).toBe(false);

	for (const claudeMode of ['acceptEdits', 'bypassPermissions', 'plan']) {
		// ${claudeMode} is Claude Code's own vocabulary — it used to parse as a free
		// string and now does not
		expect(LightsoutConfig.safeParse({ ...base, permissions: claudeMode }).success).toBe(false);
	}
});

test('LightsoutConfig: the removed driver and permissionMode keys are refused with a message naming their replacement', () => {
	const driverResult = LightsoutConfig.safeParse({ ...base, driver: 'codex' });
	const permissionModeResult = LightsoutConfig.safeParse({ ...base, permissionMode: 'bypassPermissions' });

	// the top level is not strict, so a stale key must be refused explicitly or it
	// would be silently discarded
	expect(driverResult.success).toBe(false);
	// the message is the whole point of the rejection
	expect(driverResult.error?.message ?? '').toMatch(/renamed to `harness`/);

	expect(permissionModeResult.success).toBe(false);
	expect(permissionModeResult.error?.message ?? '').toMatch(/replaced by `permissions`/);
});

test('LightsoutConfig: a stale driver inside a commands entry is a hard parse error too', () => {
	// the strict block makes the rename fail loudly in both halves of the surface
	expect(LightsoutConfig.safeParse({ ...base, commands: { implement: { driver: 'codex' } } }).success).toBe(false);
});

test('LightsoutConfig: permissions is global only — a commands entry may not carry it', () => {
	// the global level applies to every command; a command entry still overrides
	// harness/model/effort
	expect(LightsoutConfig.safeParse({ ...base, permissions: 'full-access', commands: { implement: { harness: 'codex' } } }).success).toBe(true);
	// permissions expresses a repo-wide trust posture (decision 13) — the strict
	// block refuses it per command rather than silently ignoring it
	expect(LightsoutConfig.safeParse({ ...base, commands: { implement: { permissions: 'full-access' } } }).success).toBe(false);
	// the removed name is refused inside a commands entry too, so the replacement
	// fails loudly in both halves of the surface
	expect(LightsoutConfig.safeParse({ ...base, commands: { implement: { permissionMode: 'bypassPermissions' } } }).success).toBe(false);
});

test('LightsoutConfig: a config carrying neither removed key still parses clean', () => {
	const parsed = LightsoutConfig.parse({ ...base, harness: 'codex', model: 'gpt-5.2', effort: 'high', permissions: 'write' });

	// the rejections must not fire on absence
	expect(parsed.harness).toBe('codex');
	expect('driver' in parsed).toBe(false);
	expect('permissionMode' in parsed).toBe(false);
});

test('LightsoutConfig: a typoed command key inside commands fails parsing', () => {
	// a typoed command name is a hard error, not a silently ignored override
	// (decision 8)
	expect(LightsoutConfig.safeParse({ ...base, commands: { implment: {} } }).success).toBe(false);
});

test('LightsoutConfig: a typoed field inside a commands entry fails parsing', () => {
	// a typoed entry field is a hard error, not a silently dropped model (decision
	// 8)
	expect(LightsoutConfig.safeParse({ ...base, commands: { implement: { modle: 'x' } } }).success).toBe(false);
});

test('LightsoutConfig: standards and testStandards accept folder, file, and token entries in one array, in config order', () => {
	const standards = ['standards/code', 'docs/our-extra-rules.md', 'lightsout:code-defaults'];
	const testStandards = ['standards/tests', 'lightsout:test-defaults'];

	const parsed = LightsoutConfig.parse({ ...base, standards, testStandards });

	// a folder entry is a plain string entry alongside files and tokens — the
	// schema carries no path-kind discrimination that would reject it
	expect(parsed.standards).toStrictEqual(standards);
	// testStandards accepts the same entry shapes, with entry order preserved for
	// in-place expansion
	expect(parsed.testStandards).toStrictEqual(testStandards);
});

test('LightsoutConfig: standards and testStandards accept false and absence', () => {
	const parsed = LightsoutConfig.parse({ ...base, standards: false, testStandards: false });

	// false is the explicit opt-out, distinct from an absent field
	expect(parsed.standards).toBe(false);
	// testStandards opts out the same way
	expect(parsed.testStandards).toBe(false);
	// both fields stay optional — an absent field means the bundled defaults load
	expect(LightsoutConfig.safeParse(base).success).toBe(true);
});

test('LightsoutConfig: a non-string standards entry fails parsing', () => {
	// entries are plain strings — an object entry is a hard error, pinning that
	// folder support added no structured entry form
	expect(LightsoutConfig.safeParse({ ...base, standards: [{ path: 'standards/code' }] }).success).toBe(false);
	// a bare string in place of the array is a hard error
	expect(LightsoutConfig.safeParse({ ...base, testStandards: 'standards/tests' }).success).toBe(false);
});

test('LightsoutConfig: the removed scan key is refused with a message naming standardsChecks', () => {
	const scanResult = LightsoutConfig.safeParse({ ...base, scan: { minCloneTokens: 40 } });

	// the top level is not strict, so the retired key must be refused explicitly or
	// a repo's tuning would be silently discarded and the defaults used instead
	expect(scanResult.success).toBe(false);
	// the message is the whole point of the rejection — it names the new key
	expect(scanResult.error?.message ?? '').toMatch(/renamed to `standardsChecks`/);
	// the rejection is about the key, not its contents: even an empty block fails
	expect(LightsoutConfig.safeParse({ ...base, scan: {} }).success).toBe(false);
});

test('LightsoutConfig: standardsChecks carries both override forms through parsing intact', () => {
	const standardsChecks = {
		clone: 'off',
		'size-file': { severity: 'advisory', settings: { file: 200, tsxFile: 260 } },
	};

	const parsed = LightsoutConfig.parse({ ...base, standardsChecks });

	// a bare severity and a full object are both recognized, so neither is
	// stripped as an unknown shape
	expect(parsed.standardsChecks).toStrictEqual(standardsChecks);
});

test('LightsoutConfig: a rule the map never names is left alone entirely', () => {
	const parsed = LightsoutConfig.parse({ ...base, standardsChecks: { 'size-function': { settings: { function: 40 } } } });

	// naming one rule says nothing about the other sixteen — silence is never a change
	expect(parsed.standardsChecks).toStrictEqual({ 'size-function': { settings: { function: 40 } } });
	// an empty map is valid — every rule already has a default
	expect(LightsoutConfig.parse({ ...base, standardsChecks: {} }).standardsChecks).toStrictEqual({});
	// an absent map leaves no key on the parsed config
	expect('standardsChecks' in LightsoutConfig.parse(base)).toBe(false);
});

test.each([
	{ severity: 'finding' },
	{ severity: 'advisory' },
	{ severity: 'off' },
])('LightsoutConfig: standardsChecks accepts $severity as a bare value and inside an override object', ({ severity }) => {
	const bare = LightsoutConfig.parse({ ...base, standardsChecks: { clone: severity } });
	const wrapped = LightsoutConfig.parse({ ...base, standardsChecks: { clone: { severity } } });

	// all three states are settable, including off — the only way a repo stops a
	// rule blocking is by naming it here
	expect(bare.standardsChecks).toStrictEqual({ clone: severity });
	// the object form reaches the same state, so a repo adding settings later
	// never has to restate the severity in a different vocabulary
	expect(wrapped.standardsChecks).toStrictEqual({ clone: { severity } });
});

test('LightsoutConfig: an override object may carry severity alone, settings alone, or neither', () => {
	const parsed = LightsoutConfig.parse({
		...base,
		standardsChecks: {
			clone: { severity: 'advisory' },
			'folder-census': { settings: { cap: 30 } },
			'barrel-star': {},
		},
	});

	// both fields are independently optional: severity without settings keeps the
	// rule's default knobs, settings without severity keeps its default severity,
	// and an empty object changes nothing at all
	expect(parsed.standardsChecks).toStrictEqual({
		clone: { severity: 'advisory' },
		'folder-census': { settings: { cap: 30 } },
		'barrel-star': {},
	});
});

test('LightsoutConfig: a settings value is checked as a number and nothing more', () => {
	const parsed = LightsoutConfig.parse({ ...base, standardsChecks: { clone: { settings: { minTokens: 0, ratio: 1.5 } } } });

	// settings keys belong to the rule, not the config schema, so a zero or a
	// fraction parses here — whether a value makes sense is the rule's own
	// business, not this schema's
	expect(parsed.standardsChecks).toStrictEqual({ clone: { settings: { minTokens: 0, ratio: 1.5 } } });
});

test.each([
	{ label: 'a rule id that is not in the closed list', standardsChecks: { 'size-fil': 'off' } },
	{ label: 'a severity outside the three states', standardsChecks: { clone: 'warn' } },
	{ label: 'a severity outside the three states inside an object', standardsChecks: { clone: { severity: 'warn' } } },
	{ label: 'a settings key that is not a number', standardsChecks: { clone: { settings: { minTokens: '50' } } } },
	{ label: 'an override object carrying a key the shape does not declare', standardsChecks: { clone: { severty: 'off' } } },
	{ label: 'a standardsChecks that is not an object', standardsChecks: true },
])('LightsoutConfig: $label fails parsing', ({ standardsChecks }) => {
	// a mistyped rule id or severity would silently disable an override the user
	// believes is active — the same reason the commands block is strict
	expect(LightsoutConfig.safeParse({ ...base, standardsChecks }).success).toBe(false);
});
