import { expect, test } from '@jest/globals';
import { LightsoutConfig } from '@/contracts';

const base = { gates: { check: 'c', test: 't', 'test-coverage': false } };

// The block contracts — Gates, PackageGates, ConfigCommands,
// StandardsCheckOverrides — each pin their own shape in their own test. What
// this file owns is the composed config: which blocks are required, which are
// optional, the top-level fields, and the retired keys' loud refusals.

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
	// the removed field leaves no plansDir key on the parsed config
	expect('plansDir' in parsed).toBe(false);
});

test('LightsoutConfig: gates is required, and every other block is optional', () => {
	// with no gates block there is nothing to verify a run with
	expect(LightsoutConfig.safeParse({}).success).toBe(false);
	// a config carrying only gates parses — commands, packageGates, and
	// standardsChecks are all opt-in (decision 2: backward compatibility)
	expect(LightsoutConfig.safeParse(base).success).toBe(true);
});

test('LightsoutConfig: each block reaches its own contract, valid and invalid alike', () => {
	// a valid entry in each block parses at the config level…
	const parsed = LightsoutConfig.parse({
		...base,
		commands: { implement: { harness: 'codex' } },
		packageGates: { check: 'c {package}', test: 't {package}' },
		standardsChecks: { clone: 'off' },
	});

	expect(parsed.commands).toStrictEqual({ implement: { harness: 'codex' } });
	expect(parsed.packageGates).toStrictEqual({ check: 'c {package}', test: 't {package}' });
	expect(parsed.standardsChecks).toStrictEqual({ clone: 'off' });

	// …and each block's own refusals fire through the composition, so wiring a
	// block in optional never softened it
	expect(LightsoutConfig.safeParse({ ...base, commands: { implment: {} } }).success).toBe(false);
	expect(LightsoutConfig.safeParse({ ...base, packageGates: { check: 'pnpm check', test: 't {package}' } }).success).toBe(false);
	expect(LightsoutConfig.safeParse({ ...base, standardsChecks: { clone: 'warn' } }).success).toBe(false);

	// an absent block leaves no key on the parsed config
	expect('packageGates' in LightsoutConfig.parse(base)).toBe(false);
	expect('standardsChecks' in LightsoutConfig.parse(base)).toBe(false);
});

test('LightsoutConfig: effort parses at the top level for every level, and an out-of-enum effort fails', () => {
	for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
		// ${effort} is one of the five levels every harness shares
		expect(LightsoutConfig.parse({ ...base, effort }).effort).toBe(effort);
	}

	// a typo is caught when config is read, not after a run has burned a request
	expect(LightsoutConfig.safeParse({ ...base, effort: 'ultra' }).success).toBe(false);
	// effort stays optional — absence means each harness uses its own default
	expect(LightsoutConfig.safeParse(base).success).toBe(true);
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

test('LightsoutConfig: a config carrying neither removed key still parses clean', () => {
	const parsed = LightsoutConfig.parse({ ...base, harness: 'codex', model: 'gpt-5.2', effort: 'high', permissions: 'write' });

	// the rejections must not fire on absence
	expect(parsed.harness).toBe('codex');
	expect('driver' in parsed).toBe(false);
	expect('permissionMode' in parsed).toBe(false);
});

test('LightsoutConfig: coverageSummaryPath is optional and parses as the path the coverage tooling writes', () => {
	expect(LightsoutConfig.parse({ ...base, coverageSummaryPath: 'reports/coverage-summary.json' }).coverageSummaryPath).toBe('reports/coverage-summary.json');
	// absent means the Istanbul default location — every existing config stays valid
	expect(LightsoutConfig.parse(base).coverageSummaryPath).toBe(undefined);
	// a path is a path: anything else would be read as a file name at run time
	expect(LightsoutConfig.safeParse({ ...base, coverageSummaryPath: 42 }).success).toBe(false);
});

test('LightsoutConfig: the removed scripts and packageScripts keys are refused with a message naming their new name', () => {
	const scriptsResult = LightsoutConfig.safeParse({ scripts: { check: 'c', test: 't', 'test-coverage': false } });
	const packageScriptsResult = LightsoutConfig.safeParse({ ...base, packageScripts: { check: 'c {package}', test: 't {package}' } });

	// the top level is not strict, so a stale block would otherwise be discarded
	// silently — leaving a config with no gates at all
	expect(scriptsResult.success).toBe(false);
	// the message is the whole point of the rejection — it names the new key
	expect(scriptsResult.error?.message ?? '').toMatch(/renamed to `gates`/);

	expect(packageScriptsResult.success).toBe(false);
	expect(packageScriptsResult.error?.message ?? '').toMatch(/renamed to `packageGates`/);
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
