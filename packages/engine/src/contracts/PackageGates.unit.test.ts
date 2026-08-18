import { expect, test } from '@jest/globals';
import { PackageGates } from '@/contracts';

test('PackageGates: a block whose every command carries the {package} placeholder parses intact', () => {
	const packageGates = {
		check: 'pnpm --filter {package} check',
		test: 'pnpm --filter {package} test:unit',
		'test-coverage': 'pnpm --filter {package} test:coverage',
		build: 'pnpm --filter {package} build',
	};

	// the scoped commands survive parsing unchanged — the placeholder is checked,
	// never substituted here
	expect(PackageGates.parse(packageGates)).toStrictEqual(packageGates);
	// the two optional scoped gates may be omitted
	expect(PackageGates.parse({ check: 'c {package}', test: 't {package}' })).toStrictEqual({ check: 'c {package}', test: 't {package}' });
});

test('PackageGates: a command missing the {package} placeholder is refused with a message naming it', () => {
	const result = PackageGates.safeParse({ check: 'pnpm check', test: 'pnpm --filter {package} test:unit' });

	// a command without the placeholder would run identically for every package —
	// silently doing the same work N times instead of scoping it
	expect(result.success).toBe(false);
	expect(result.error?.message ?? '').toMatch(/\{package\} placeholder/);
	// the check reaches the optional entries too, not just the two required ones
	expect(PackageGates.safeParse({ check: 'c {package}', test: 't {package}', build: 'pnpm build' }).success).toBe(false);
});

test('PackageGates: a stale testUnit key is refused with a message naming its new name', () => {
	const result = PackageGates.safeParse({ check: 'c {package}', test: 't {package}', testUnit: 't {package}' });

	// the rename fails loudly in the scoped half of the surface too
	expect(result.success).toBe(false);
	expect(result.error?.message ?? '').toMatch(/renamed to `test`/);
});

test('PackageGates: a stale camelCase testCoverage is refused with a message naming the kebab key', () => {
	const result = PackageGates.safeParse({ check: 'c {package}', test: 't {package}', testCoverage: 'x {package}' });

	expect(result.success).toBe(false);
	expect(result.error?.message ?? '').toMatch(/renamed to `test-coverage`/);
});

test('PackageGates: a custom `test-*` suite parses in place, and the placeholder check reaches it too', () => {
	const gates = { check: 'c {package}', test: 't {package}', 'test-e2e': 'e {package}' };

	expect(PackageGates.parse(gates)).toStrictEqual(gates);
	// a custom suite without the placeholder would run identically for every package
	expect(PackageGates.safeParse({ ...gates, 'test-e2e': 'pnpm test:e2e' }).success).toBe(false);
});

test('PackageGates: an unknown key that is not a `test-*` suite fails parsing instead of being stripped', () => {
	const result = PackageGates.safeParse({ check: 'c {package}', test: 't {package}', bulid: 'b {package}' });

	expect(result.success).toBe(false);
	expect(result.error?.message ?? '').toMatch(/unknown scoped gate 'bulid'/);
});
