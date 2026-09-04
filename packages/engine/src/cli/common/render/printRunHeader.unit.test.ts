import { expect, jest, test } from '@jest/globals';
import { printRunHeader } from '#src/cli/common/render/printRunHeader.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';

// The header's whole output IS its console.log lines, so capturing them is the
// arrangement. `t.mock.method` restores the real console.log when the test
// ends, so nothing leaks into the reporter.
const setupHeader = ({ config = {}, driverName = 'claude-code' }: { config?: Partial<LightsoutConfig>; driverName?: string } = {}) => {
	const logged: string[] = [];

	jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		logged.push(String(args[0]));
	});

	const driver: Driver = { name: driverName, invoke: async () => ({ text: '', exitCode: 0 }) };
	const fullConfig: LightsoutConfig = { gates: { check: 'pnpm check', test: 'pnpm test:unit', 'test-coverage': 'pnpm test:coverage' }, ...config };

	return { config: fullConfig, driver, cwd: '/repo', logged };
};

const lineFor = ({ logged, label }: { logged: string[]; label: string }) => logged.find((line) => line.startsWith(`  ${label}:`));

test('printRunHeader: a minimal config renders exactly the always-present lines, with every default spelled out', () => {
	const { config, driver, cwd, logged } = setupHeader();

	printRunHeader({ config, driver, cwd });

	expect(logged).toStrictEqual([
		'  cwd: /repo',
		'  standards packs: lightsout-defaults (none configured — set to false to disable, or list pack roots)',
		'  harness: claude-code · model: harness default · effort: harness default · permissions: write',
		'  timeouts: agent 60m · supervisor 15m · gate 15m',
		'  gates (root): check=[pnpm check] test=[pnpm test:unit] coverage=[pnpm test:coverage]',
	]);
});

test('printRunHeader: the harness line names the resolved harness, model, effort, and permissions', () => {
	const { config, driver, cwd, logged } = setupHeader({ driverName: 'codex', config: { model: 'gpt-5.2', effort: 'high', permissions: 'full-access' } });

	printRunHeader({ config, driver, cwd });

	expect(lineFor({ logged, label: 'harness' })).toBe('  harness: codex · model: gpt-5.2 · effort: high · permissions: full-access');
});

test('printRunHeader: an explicit package list is printed verbatim, in config order', () => {
	const { config, driver, cwd, logged } = setupHeader({ config: { 'standards-packs': ['standards/house', '/opt/acme-standards'] } });

	printRunHeader({ config, driver, cwd });

	expect(lineFor({ logged, label: 'standards packs' })).toBe('  standards packs: standards/house, /opt/acme-standards');
});

test('printRunHeader: standards turned off explicitly are announced as such', () => {
	const { config, driver, cwd, logged } = setupHeader({ config: { 'standards-packs': false } });

	printRunHeader({ config, driver, cwd });

	expect(lineFor({ logged, label: 'standards packs' })).toBe('  standards packs: none (explicit)');
});

test('printRunHeader: an empty package list is still a configured list — the line prints with nothing after the label', () => {
	const { config, driver, cwd, logged } = setupHeader({ config: { 'standards-packs': [] } });

	printRunHeader({ config, driver, cwd });

	// an empty array is a list, not an absent key — it must not fall through to
	// the unset wording that promises the bundled defaults
	expect(lineFor({ logged, label: 'standards packs' })).toBe('  standards packs: ');
});

test('printRunHeader: configured timeouts replace the 60m/15m/15m defaults', () => {
	const { config, driver, cwd, logged } = setupHeader({ config: { timeouts: { 'agent-minutes': 90, 'supervisor-minutes': 5, 'gate-minutes': 20 } } });

	printRunHeader({ config, driver, cwd });

	expect(lineFor({ logged, label: 'timeouts' })).toBe('  timeouts: agent 90m · supervisor 5m · gate 20m');
});

test('printRunHeader: a coverage gate disabled explicitly prints off (explicit) in place of a command', () => {
	const { config, driver, cwd, logged } = setupHeader({ config: { gates: { check: 'pnpm check', test: 'pnpm test:unit', 'test-coverage': false } } });

	printRunHeader({ config, driver, cwd });

	expect(lineFor({ logged, label: 'gates (root)' })).toBe('  gates (root): check=[pnpm check] test=[pnpm test:unit] coverage=[off (explicit)]');
});

test('printRunHeader: the opt-in generate, build, and format lines print only when their commands are configured', () => {
	const { config, driver, cwd, logged } = setupHeader({
		config: {
			gates: { check: 'pnpm check', test: 'pnpm test:unit', 'test-coverage': false, generate: 'pnpm gen', build: 'pnpm build', format: 'pnpm format' },
		},
	});

	printRunHeader({ config, driver, cwd });

	expect(lineFor({ logged, label: 'generate (before every gate set)' })).toBe('  generate (before every gate set): [pnpm gen]');
	expect(lineFor({ logged, label: 'gates (root, opt-in)' })).toBe('  gates (root, opt-in): build=[pnpm build]');
	expect(lineFor({ logged, label: 'format' })).toBe('  format: [pnpm format]');
});

test('printRunHeader: granted agent commands print as bracketed prefixes', () => {
	const { config, driver, cwd, logged } = setupHeader({ config: { 'agent-commands': ['pnpm db:migrate', 'npx prisma'] } });

	printRunHeader({ config, driver, cwd });

	expect(lineFor({ logged, label: 'agent commands (granted, prefix match)' })).toBe('  agent commands (granted, prefix match): [pnpm db:migrate] [npx prisma]');
});

test('printRunHeader: an empty grant list prints no agent commands line at all', () => {
	const { config, driver, cwd, logged } = setupHeader({ config: { 'agent-commands': [] } });

	printRunHeader({ config, driver, cwd });

	// an empty grant list is the same as none — the header stays quiet
	expect(logged.some((line) => line.includes('agent commands'))).toBe(false);
});

test('printRunHeader: generated path prefixes print as the never-attributed list', () => {
	const { config, driver, cwd, logged } = setupHeader({ config: { generated: ['src/generated', 'prisma/client'] } });

	printRunHeader({ config, driver, cwd });

	expect(lineFor({ logged, label: 'generated (never attributed)' })).toBe('  generated (never attributed): src/generated, prisma/client');
});

test('printRunHeader: package-scoped gates print with no coverage entry when none is configured', () => {
	const { config, driver, cwd, logged } = setupHeader({
		config: { 'package-gates': { check: 'pnpm --filter {package} check', test: 'pnpm --filter {package} test' } },
	});

	printRunHeader({ config, driver, cwd });

	expect(lineFor({ logged, label: 'gates (per package)' })).toBe(
		'  gates (per package): check=[pnpm --filter {package} check] test=[pnpm --filter {package} test]',
	);
});

test('printRunHeader: a scoped coverage gate is appended to the per-package line', () => {
	const { config, driver, cwd, logged } = setupHeader({
		config: {
			'package-gates': { check: 'pnpm --filter {package} check', test: 'pnpm --filter {package} test', 'test-coverage': 'pnpm --filter {package} coverage' },
		},
	});

	printRunHeader({ config, driver, cwd });

	expect(lineFor({ logged, label: 'gates (per package)' })).toBe(
		'  gates (per package): check=[pnpm --filter {package} check] test=[pnpm --filter {package} test] coverage=[pnpm --filter {package} coverage]',
	);
});
