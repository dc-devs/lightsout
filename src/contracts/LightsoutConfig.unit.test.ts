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

test('LightsoutConfig: a leftover plansDir key parses without error and is stripped from the result', () => {
	const parsed = LightsoutConfig.parse({ ...base, plansDir: 'docs/plans' });

	// unlike driver and scan, the removed plans root gets no explicit rejection: a
	// plan now always lives in its own workspace folder, so a config still carrying
	// the old key keeps parsing instead of failing the run
	expect(LightsoutConfig.safeParse({ ...base, plansDir: 'docs/plans' }).success).toBe(true);
	// the removed field leaves no plansDir key on the parsed config, so nothing
	// downstream can read a plans root back out of it
	expect('plansDir' in parsed).toBe(false);
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

test('LightsoutConfig: the coverage command has its own commands entry, and a typo near it is still refused', () => {
	const parsed = LightsoutConfig.parse({ ...base, commands: { 'test-coverage-to-threshold': { harness: 'codex', effort: 'high' } } });

	// the coverage run is a long unattended loop — it earns a harness of its own
	expect(parsed.commands?.['test-coverage-to-threshold']).toStrictEqual({ harness: 'codex', effort: 'high' });
	// the strict block means a near-miss disables an override the user believes
	// is active, so it fails loudly instead
	expect(LightsoutConfig.safeParse({ ...base, commands: { 'test-coverage': {} } }).success).toBe(false);
});

test('LightsoutConfig: coverageSummaryPath is optional and parses as the path the coverage tooling writes', () => {
	expect(LightsoutConfig.parse({ ...base, coverageSummaryPath: 'reports/coverage-summary.json' }).coverageSummaryPath).toBe('reports/coverage-summary.json');
	// absent means the Istanbul default location — every existing config stays valid
	expect(LightsoutConfig.parse(base).coverageSummaryPath).toBe(undefined);
	// a path is a path: anything else would be read as a file name at run time
	expect(LightsoutConfig.safeParse({ ...base, coverageSummaryPath: 42 }).success).toBe(false);
});

test('LightsoutConfig: a typoed field inside a commands entry fails parsing', () => {
	// a typoed entry field is a hard error, not a silently dropped model (decision
	// 8)
	expect(LightsoutConfig.safeParse({ ...base, commands: { implement: { modle: 'x' } } }).success).toBe(false);
});

test('LightsoutConfig: a packageScripts block whose every command carries the {package} placeholder parses intact', () => {
	const packageScripts = {
		check: 'pnpm --filter {package} check',
		testUnit: 'pnpm --filter {package} test:unit',
		testCoverage: 'pnpm --filter {package} test:coverage',
		build: 'pnpm --filter {package} build',
	};

	const parsed = LightsoutConfig.parse({ ...base, packageScripts });

	// the scoped commands survive parsing unchanged — the placeholder is checked,
	// never substituted here
	expect(parsed.packageScripts).toStrictEqual(packageScripts);
	// the two optional scoped gates may be omitted, and the whole block is optional
	expect(LightsoutConfig.parse({ ...base, packageScripts: { check: 'c {package}', testUnit: 't {package}' } }).packageScripts).toStrictEqual({
		check: 'c {package}',
		testUnit: 't {package}',
	});
	// an absent block leaves no key on the parsed config — single-package repos run
	// scripts.* and nothing else
	expect('packageScripts' in LightsoutConfig.parse(base)).toBe(false);
});

test('LightsoutConfig: a packageScripts command missing the {package} placeholder is refused with a message naming it', () => {
	const result = LightsoutConfig.safeParse({ ...base, packageScripts: { check: 'pnpm check', testUnit: 'pnpm --filter {package} test:unit' } });

	// a command without the placeholder would run identically for every package —
	// silently doing the same work N times instead of scoping it
	expect(result.success).toBe(false);
	expect(result.error?.message ?? '').toMatch(/\{package\} placeholder/);
	// the check reaches the optional entries too, not just the two required ones
	expect(LightsoutConfig.safeParse({ ...base, packageScripts: { check: 'c {package}', testUnit: 't {package}', build: 'pnpm build' } }).success).toBe(false);
});

test('LightsoutConfig: standardsPackages accepts relative and absolute package roots, in config order', () => {
	const standardsPackages = ['standards/house', '/opt/acme-standards'];

	const parsed = LightsoutConfig.parse({ ...base, standardsPackages });

	// entries are plain strings either way — the schema carries no path-kind
	// discrimination, and order is the order packages stack in
	expect(parsed.standardsPackages).toStrictEqual(standardsPackages);
});

test('LightsoutConfig: standardsPackages accepts false and absence', () => {
	const parsed = LightsoutConfig.parse({ ...base, standardsPackages: false });

	// false is the explicit opt-out, distinct from an absent field
	expect(parsed.standardsPackages).toBe(false);
	// the field stays optional — an absent field means the shipped default package loads
	expect(LightsoutConfig.safeParse(base).success).toBe(true);
});

test('LightsoutConfig: a non-string standardsPackages entry fails parsing', () => {
	// entries are plain strings — an object entry is a hard error
	expect(LightsoutConfig.safeParse({ ...base, standardsPackages: [{ path: 'standards/house' }] }).success).toBe(false);
	// a bare string in place of the array is a hard error
	expect(LightsoutConfig.safeParse({ ...base, standardsPackages: 'standards/house' }).success).toBe(false);
});

test('LightsoutConfig: an empty standardsPackages array parses and stays empty', () => {
	const parsed = LightsoutConfig.parse({ ...base, standardsPackages: [] });

	// an array says "exactly these", so an empty one says "exactly none" and must
	// survive parsing as itself — collapsing it to absence would load the shipped
	// default package the config just declined
	expect(parsed.standardsPackages).toStrictEqual([]);
	// and it is a present key, unlike an absent field
	expect('standardsPackages' in parsed).toBe(true);
});

test.each([
	{ label: 'a standardsPackages of true', standardsPackages: true },
	{ label: 'a standardsPackages of null', standardsPackages: null },
	{ label: 'a standardsPackages of 0', standardsPackages: 0 },
	{ label: 'a standardsPackages object', standardsPackages: { roots: ['standards/house'] } },
])('LightsoutConfig: $label fails parsing', ({ standardsPackages }) => {
	// the opt-out is the literal false and nothing else — a truthy or nullish value
	// near it would otherwise read as an opt-out and silently drop every standard
	expect(LightsoutConfig.safeParse({ ...base, standardsPackages }).success).toBe(false);
});

test('LightsoutConfig: the removed standards and testStandards keys are refused with a message naming standardsPackages', () => {
	const codeResult = LightsoutConfig.safeParse({ ...base, standards: ['docs/style.md'] });
	const testResult = LightsoutConfig.safeParse({ ...base, testStandards: ['docs/tests.md'] });

	// the top level is not strict, so a retired key must be refused explicitly or a
	// repo's standards would be silently dropped and the defaults used instead
	expect(codeResult.success).toBe(false);
	expect(codeResult.error?.message ?? '').toMatch(/replaced by `standardsPackages`/);
	expect(testResult.success).toBe(false);
	expect(testResult.error?.message ?? '').toMatch(/replaced by `standardsPackages`/);
	// the rejection is about the key, not its contents: even the old opt-out value fails
	expect(LightsoutConfig.safeParse({ ...base, standards: false }).success).toBe(false);
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

test('LightsoutConfig: the renamed finding severity is refused with a message naming blocking', () => {
	const bare = LightsoutConfig.safeParse({ ...base, standardsChecks: { clone: 'finding' } });

	// a value copied from the pre-rename docs is told what happened, rather than
	// being handed a bare list of the three valid options
	expect(bare.success).toBe(false);
	expect(bare.error?.message ?? '').toMatch(/severity `finding` was renamed to `blocking`/);

	// the object form takes the same value in a different position — both reject
	const nested = LightsoutConfig.safeParse({ ...base, standardsChecks: { clone: { severity: 'finding' } } });

	expect(nested.success).toBe(false);
	expect(nested.error?.message ?? '').toMatch(/severity `finding` was renamed to `blocking`/);

	// an ordinary typo keeps the ordinary enum error — only the retired spelling is called out
	expect(LightsoutConfig.safeParse({ ...base, standardsChecks: { clone: 'blockign' } }).error?.message ?? '').not.toMatch(/was renamed/);
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
	{ severity: 'blocking' },
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

test('LightsoutConfig: a rule id this schema has never heard of parses, because the packages own the vocabulary', () => {
	const parsed = LightsoutConfig.parse({ ...base, standardsChecks: { 'house-style-no-default-export': 'off', 'size-fil': 'off' } });

	// a third-party standards package brings its own rule ids, so a closed list
	// here would refuse every package but the bundled one. The typo `size-fil`
	// is still caught — by `resolvePackageRuleStates`, where the loaded packages
	// make the valid ids knowable, and it names them in the refusal
	expect(parsed.standardsChecks).toStrictEqual({ 'house-style-no-default-export': 'off', 'size-fil': 'off' });
});

test.each([
	{ label: 'a severity outside the three states', standardsChecks: { clone: 'warn' } },
	{ label: 'a severity outside the three states inside an object', standardsChecks: { clone: { severity: 'warn' } } },
	{ label: 'a settings key that is not a number', standardsChecks: { clone: { settings: { minTokens: '50' } } } },
	{ label: 'an override object carrying a key the shape does not declare', standardsChecks: { clone: { severty: 'off' } } },
	{ label: 'a standardsChecks that is not an object', standardsChecks: true },
])('LightsoutConfig: $label fails parsing', ({ standardsChecks }) => {
	// a mistyped severity would silently disable an override the user believes is
	// active — the same reason the commands block is strict
	expect(LightsoutConfig.safeParse({ ...base, standardsChecks }).success).toBe(false);
});
