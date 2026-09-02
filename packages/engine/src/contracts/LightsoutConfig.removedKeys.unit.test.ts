import { expect, test } from '@jest/globals';
import { LightsoutConfig } from '#src/contracts/index.ts';

const base = { gates: { check: 'c', test: 't', 'test-coverage': false } };

// Every spelling the config once accepted and no longer does. Two kinds live
// here, and the difference is the point: a key whose capability is simply gone
// is stripped without a word, while a key that MOVED is refused by name so a
// stale config says where the setting went rather than losing it silently.

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

test.each([
	{ key: 'tracker', to: 'ticket-tracker.provider' },
	{ key: 'team', to: 'ticket-tracker.team' },
	{ key: 'api-key-env', to: 'ticket-tracker.api-key-env' },
])('LightsoutConfig: the moved queue.$key spelling is refused with a message naming $to', ({ key, to }) => {
	const queue = { 'route-labels': { direct: 'route-direct', 'auto-plan': 'route-auto-plan' }, 'max-parallel': 3, [key]: 'linear' };
	const result = LightsoutConfig.safeParse({ ...base, queue });

	// the tombstone is declared inside the queue block because a stale config
	// writes the key nested there — a top-level one would never be reached, and
	// the strict block would report a generic unrecognized key naming nothing
	expect(result.success).toBe(false);
	expect(result.error?.message ?? '').toMatch(new RegExp(`\`queue.${key}\` was renamed to \`${to}\``));
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

test('LightsoutConfig: the camelCase executorFileLimit is stripped rather than refused by name', () => {
	const parsed = LightsoutConfig.parse({ ...base, executorFileLimit: 80 });

	// unlike every renamed key beside it, this one is new: there is no earlier
	// spelling to migrate from, so no refusal is declared and the unknown key is
	// simply dropped the way zod drops any other
	expect('executorFileLimit' in parsed).toBe(false);
	expect(parsed['executor-file-limit']).toBe(undefined);
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
	expect(packageScriptsResult.error?.message ?? '').toMatch(/renamed to `package-gates`/);
});

test('LightsoutConfig: the removed standards-packages spelling is refused with a message naming standards-packs', () => {
	const result = LightsoutConfig.safeParse({ ...base, 'standards-packages': ['standards/house'] });

	// the top level is not strict, so the old kebab spelling would otherwise be
	// stripped silently and the repo would run the defaults it thought it replaced
	expect(result.success).toBe(false);
	expect(result.error?.message ?? '').toMatch(/`standards-packages` was renamed to `standards-packs`/);
	// the rejection is about the key, not its contents: even the opt-out value fails
	expect(LightsoutConfig.safeParse({ ...base, 'standards-packages': false }).success).toBe(false);
});

test('LightsoutConfig: a half-migrated config carrying the new key beside a stale spelling still fails', () => {
	const kebabResult = LightsoutConfig.safeParse({ ...base, 'standards-packs': ['standards/house'], 'standards-packages': ['standards/old'] });
	const camelResult = LightsoutConfig.safeParse({ ...base, 'standards-packs': ['standards/house'], standardsPackages: ['standards/old'] });

	// a correct new key beside a stale one is the likeliest half-done migration, and
	// the refusal must still fire: otherwise the stale roots are stripped in silence
	// and the config reads as if it had asked for both
	expect(kebabResult.success).toBe(false);
	expect(kebabResult.error?.message ?? '').toMatch(/`standards-packages` was renamed to `standards-packs`/);
	expect(camelResult.success).toBe(false);
	expect(camelResult.error?.message ?? '').toMatch(/`standardsPackages` was renamed to `standards-packs`/);
});

test('LightsoutConfig: the removed standards and testStandards keys are refused with a message naming standards-packs', () => {
	const codeResult = LightsoutConfig.safeParse({ ...base, standards: ['docs/style.md'] });
	const testResult = LightsoutConfig.safeParse({ ...base, testStandards: ['docs/tests.md'] });

	// the top level is not strict, so a retired key must be refused explicitly or a
	// repo's standards would be silently dropped and the defaults used instead
	expect(codeResult.success).toBe(false);
	expect(codeResult.error?.message ?? '').toMatch(/replaced by `standards-packs`/);
	expect(testResult.success).toBe(false);
	expect(testResult.error?.message ?? '').toMatch(/replaced by `standards-packs`/);
	// the rejection is about the key, not its contents: even the old opt-out value fails
	expect(LightsoutConfig.safeParse({ ...base, standards: false }).success).toBe(false);
});

test('LightsoutConfig: the removed scan key is refused with a message naming standards-checks', () => {
	const scanResult = LightsoutConfig.safeParse({ ...base, scan: { minCloneTokens: 40 } });

	// the top level is not strict, so the retired key must be refused explicitly or
	// a repo's tuning would be silently discarded and the defaults used instead
	expect(scanResult.success).toBe(false);
	// the message is the whole point of the rejection — it names the new key
	expect(scanResult.error?.message ?? '').toMatch(/renamed to `standards-checks`/);
	// the rejection is about the key, not its contents: even an empty block fails
	expect(LightsoutConfig.safeParse({ ...base, scan: {} }).success).toBe(false);
});

test.each([
	{ key: 'agentCommands', value: ['pnpm'], to: 'agent-commands' },
	{ key: 'coverageSummaryPath', value: 'reports/summary.json', to: 'coverage-summary-path' },
	{ key: 'packagesDir', value: 'apps', to: 'packages-dir' },
	{ key: 'packageGates', value: { check: 'c {package}', test: 't {package}' }, to: 'package-gates' },
	{ key: 'standardsPackages', value: false, to: 'standards-packs' },
	{ key: 'standardsChannels', value: ['react'], to: 'standards-channels' },
	{ key: 'standardsChecks', value: { 'duplicate-code-block': 'off' }, to: 'standards-checks' },
])('LightsoutConfig: the camelCase $key is refused with a message naming $to', ({ key, value, to }) => {
	const result = LightsoutConfig.safeParse({ ...base, [key]: value });

	// every key is kebab-case now; the old spelling would otherwise be stripped
	// silently and the setting it carried would quietly stop applying
	expect(result.success).toBe(false);
	expect(result.error?.message ?? '').toMatch(new RegExp(`\`${key}\` was renamed to \`${to}\``));
});

test('LightsoutConfig: the timeouts block takes kebab-case minutes and refuses the camelCase spellings by name', () => {
	const parsed = LightsoutConfig.parse({ ...base, timeouts: { 'agent-minutes': 90, 'supervisor-minutes': 20 } });

	expect(parsed.timeouts).toStrictEqual({ 'agent-minutes': 90, 'supervisor-minutes': 20 });

	const agentResult = LightsoutConfig.safeParse({ ...base, timeouts: { agentMinutes: 90 } });
	const supervisorResult = LightsoutConfig.safeParse({ ...base, timeouts: { supervisorMinutes: 20 } });

	expect(agentResult.success).toBe(false);
	expect(agentResult.error?.message ?? '').toMatch(/`timeouts.agentMinutes` was renamed to `timeouts.agent-minutes`/);
	expect(supervisorResult.success).toBe(false);
	expect(supervisorResult.error?.message ?? '').toMatch(/`timeouts.supervisorMinutes` was renamed to `timeouts.supervisor-minutes`/);
});
