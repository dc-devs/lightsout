import { expect, test } from '@jest/globals';
import { ConfigGates } from '@/contracts';

test('ConfigGates: a block carries every command through parsing, with test holding the fast red/green command', () => {
	const gates = {
		check: 'pnpm check',
		test: 'pnpm test',
		'test-coverage': 'pnpm test:unit:coverage',
		generate: 'pnpm codegen',
		build: 'pnpm build',
		format: 'pnpm format',
	};

	// the whole block survives parsing unchanged — commands are read straight off it
	expect(ConfigGates.parse(gates)).toStrictEqual(gates);
	// the three opt-in gates may be omitted, and the coverage gate takes the
	// literal false as its explicit opt-out
	expect(ConfigGates.parse({ check: 'c', test: 't', 'test-coverage': false })).toStrictEqual({ check: 'c', test: 't', 'test-coverage': false });
});

test('ConfigGates: check, test, and testCoverage are each required', () => {
	// the fast test command is not optional under its new name — a block naming
	// only the other two fails rather than running no tests at all
	expect(ConfigGates.safeParse({ check: 'c', 'test-coverage': false }).success).toBe(false);
	expect(ConfigGates.safeParse({ test: 't', 'test-coverage': false }).success).toBe(false);
	// silence on coverage is not an option: skipping the strongest gate has to be
	// the literal false, spelled out
	expect(ConfigGates.safeParse({ check: 'c', test: 't' }).success).toBe(false);
	// and true is not an opt-in — a command or the false is the whole union
	expect(ConfigGates.safeParse({ check: 'c', test: 't', 'test-coverage': true }).success).toBe(false);
});

test('ConfigGates: a stale testUnit key is refused with a message naming its new name', () => {
	const result = ConfigGates.safeParse({ check: 'c', test: 't', testUnit: 't', 'test-coverage': false });

	// the rename fails loudly rather than the stale key being stripped and its
	// command never running
	expect(result.success).toBe(false);
	expect(result.error?.message ?? '').toMatch(/renamed to `test`/);
});

test('ConfigGates: a stale camelCase testCoverage is refused with a message naming the kebab key', () => {
	const result = ConfigGates.safeParse({ check: 'c', test: 't', testCoverage: false });

	// the rename fails loudly rather than the old spelling being silently stripped
	expect(result.success).toBe(false);
	expect(result.error?.message ?? '').toMatch(/renamed to `test-coverage`/);
});

test('ConfigGates: custom `test-*` suites are part of the block, and parsing keeps them in place', () => {
	const gates = { check: 'c', test: 't', 'test-coverage': false, 'test-e2e': 'pnpm test:e2e', 'test-integration': 'pnpm test:int' };

	// validation only — the parsed block is the written block, so a run
	// manifest's config snapshot round-trips through this schema unchanged
	expect(ConfigGates.parse(gates)).toStrictEqual(gates);
	expect(ConfigGates.parse(ConfigGates.parse(gates))).toStrictEqual(gates);
});

test('ConfigGates: an unknown key that is not a `test-*` suite fails parsing instead of being stripped', () => {
	const result = ConfigGates.safeParse({ check: 'c', test: 't', 'test-coverage': false, buidl: 'pnpm bundle' });

	// a silently dropped gate is a suite that never runs
	expect(result.success).toBe(false);
	expect(result.error?.message ?? '').toMatch(/unknown gate 'buidl'/);
});

test('ConfigGates: a custom test suite must be a full shell command string', () => {
	const result = ConfigGates.safeParse({ check: 'c', test: 't', 'test-coverage': false, 'test-e2e': false });

	expect(result.success).toBe(false);
	expect(result.error?.message ?? '').toMatch(/'test-e2e' must be a full shell command string/);
});
