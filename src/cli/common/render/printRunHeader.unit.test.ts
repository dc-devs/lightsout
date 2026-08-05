import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { LightsoutConfig } from '@/contracts';
import type { Driver } from '@/drivers';
import { printRunHeader } from '@/cli/common/render/printRunHeader';

// The header's whole output IS its console.log lines, so capturing them is the
// arrangement. `t.mock.method` restores the real console.log when the test
// ends, so nothing leaks into the reporter.
const setupHeader = ({ t, config = {}, driverName = 'claude-code' }: { t: TestContext; config?: Partial<LightsoutConfig>; driverName?: string }) => {
	const logged: string[] = [];

	t.mock.method(console, 'log', (...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	const driver: Driver = { name: driverName, invoke: async () => ({ text: '', exitCode: 0 }) };
	const fullConfig: LightsoutConfig = { scripts: { check: 'pnpm check', testUnit: 'pnpm test:unit', testCoverage: 'pnpm test:coverage' }, ...config };

	return { config: fullConfig, driver, cwd: '/repo', logged };
};

const lineFor = ({ logged, label }: { logged: string[]; label: string }) => logged.find((line) => line.startsWith(`  ${label}:`));

test('printRunHeader: a minimal config renders exactly the always-present lines, with every default spelled out', (t) => {
	const { config, driver, cwd, logged } = setupHeader({ t });

	printRunHeader({ config, driver, cwd });

	assert.deepEqual(logged, [
		'  cwd: /repo',
		'  standards: lightsout js defaults (none configured — set to false to disable, or list files/lightsout:code-defaults)',
		'  test standards: lightsout js defaults (none configured — set to false to disable, or list files/lightsout:test-defaults)',
		'  harness: claude-code · model: harness default · effort: harness default · permissions: write',
		'  timeouts: agent 60m · supervisor 15m',
		'  gates (root): check=[pnpm check] testUnit=[pnpm test:unit] coverage=[pnpm test:coverage]',
	]);
});

test('printRunHeader: the harness line names the resolved harness, model, effort, and permissions', (t) => {
	const { config, driver, cwd, logged } = setupHeader({ t, driverName: 'codex', config: { model: 'gpt-5.2', effort: 'high', permissions: 'full-access' } });

	printRunHeader({ config, driver, cwd });

	assert.equal(lineFor({ logged, label: 'harness' }), '  harness: codex · model: gpt-5.2 · effort: high · permissions: full-access');
});

test('printRunHeader: an explicit standards list is printed verbatim for each role', (t) => {
	const { config, driver, cwd, logged } = setupHeader({ t, config: { standards: ['docs/style.md', 'lightsout:code-defaults'], testStandards: ['docs/tests.md'] } });

	printRunHeader({ config, driver, cwd });

	assert.equal(lineFor({ logged, label: 'standards' }), '  standards: docs/style.md, lightsout:code-defaults');
	assert.equal(lineFor({ logged, label: 'test standards' }), '  test standards: docs/tests.md');
});

test('printRunHeader: standards turned off explicitly are announced as such for each role', (t) => {
	const { config, driver, cwd, logged } = setupHeader({ t, config: { standards: false, testStandards: false } });

	printRunHeader({ config, driver, cwd });

	assert.equal(lineFor({ logged, label: 'standards' }), '  standards: none (explicit)');
	assert.equal(lineFor({ logged, label: 'test standards' }), '  test standards: none (explicit)');
});

test('printRunHeader: configured timeouts replace the 60m/15m defaults', (t) => {
	const { config, driver, cwd, logged } = setupHeader({ t, config: { timeouts: { agentMinutes: 90, supervisorMinutes: 5 } } });

	printRunHeader({ config, driver, cwd });

	assert.equal(lineFor({ logged, label: 'timeouts' }), '  timeouts: agent 90m · supervisor 5m');
});

test('printRunHeader: a coverage gate disabled explicitly prints off (explicit) in place of a command', (t) => {
	const { config, driver, cwd, logged } = setupHeader({ t, config: { scripts: { check: 'pnpm check', testUnit: 'pnpm test:unit', testCoverage: false } } });

	printRunHeader({ config, driver, cwd });

	assert.equal(lineFor({ logged, label: 'gates (root)' }), '  gates (root): check=[pnpm check] testUnit=[pnpm test:unit] coverage=[off (explicit)]');
});

test('printRunHeader: the opt-in generate, build, and format lines print only when their commands are configured', (t) => {
	const { config, driver, cwd, logged } = setupHeader({
		t,
		config: { scripts: { check: 'pnpm check', testUnit: 'pnpm test:unit', testCoverage: false, generate: 'pnpm gen', build: 'pnpm build', format: 'pnpm format' } },
	});

	printRunHeader({ config, driver, cwd });

	assert.equal(lineFor({ logged, label: 'generate (before every gate set)' }), '  generate (before every gate set): [pnpm gen]');
	assert.equal(lineFor({ logged, label: 'gates (root, opt-in)' }), '  gates (root, opt-in): build=[pnpm build]');
	assert.equal(lineFor({ logged, label: 'format' }), '  format: [pnpm format]');
});

test('printRunHeader: granted agent commands print as bracketed prefixes', (t) => {
	const { config, driver, cwd, logged } = setupHeader({ t, config: { agentCommands: ['pnpm db:migrate', 'npx prisma'] } });

	printRunHeader({ config, driver, cwd });

	assert.equal(lineFor({ logged, label: 'agent commands (granted, prefix match)' }), '  agent commands (granted, prefix match): [pnpm db:migrate] [npx prisma]');
});

test('printRunHeader: an empty grant list prints no agent commands line at all', (t) => {
	const { config, driver, cwd, logged } = setupHeader({ t, config: { agentCommands: [] } });

	printRunHeader({ config, driver, cwd });

	assert.equal(
		logged.some((line) => line.includes('agent commands')),
		false,
		'an empty grant list is the same as none — the header stays quiet',
	);
});

test('printRunHeader: generated path prefixes print as the never-attributed list', (t) => {
	const { config, driver, cwd, logged } = setupHeader({ t, config: { generated: ['src/generated', 'prisma/client'] } });

	printRunHeader({ config, driver, cwd });

	assert.equal(lineFor({ logged, label: 'generated (never attributed)' }), '  generated (never attributed): src/generated, prisma/client');
});

test('printRunHeader: package-scoped gates print with no coverage entry when none is configured', (t) => {
	const { config, driver, cwd, logged } = setupHeader({ t, config: { packageScripts: { check: 'pnpm --filter {package} check', testUnit: 'pnpm --filter {package} test' } } });

	printRunHeader({ config, driver, cwd });

	assert.equal(lineFor({ logged, label: 'gates (per package)' }), '  gates (per package): check=[pnpm --filter {package} check] testUnit=[pnpm --filter {package} test]');
});

test('printRunHeader: a scoped coverage gate is appended to the per-package line', (t) => {
	const { config, driver, cwd, logged } = setupHeader({
		t,
		config: { packageScripts: { check: 'pnpm --filter {package} check', testUnit: 'pnpm --filter {package} test', testCoverage: 'pnpm --filter {package} coverage' } },
	});

	printRunHeader({ config, driver, cwd });

	assert.equal(
		lineFor({ logged, label: 'gates (per package)' }),
		'  gates (per package): check=[pnpm --filter {package} check] testUnit=[pnpm --filter {package} test] coverage=[pnpm --filter {package} coverage]',
	);
});
