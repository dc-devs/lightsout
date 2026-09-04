import { expect, test } from '@jest/globals';
import { LightsoutConfig } from '#src/contracts/index.ts';

// `gate-overrides` is the one block whose names cannot be checked by the block
// itself: a gate may be configured under `gates`, under `package-gates`, or
// nowhere at all, and only the composed config sees all three at once. What
// this file owns is that cross-block check. The block's own refusals — an
// empty list, `generate`, `format`, a repeated name — are pinned beside it in
// `GateOverrides.unit.test.ts`.

const setupConfig = ({
	gates,
	packageGates,
	overrides,
}: {
	gates: Record<string, unknown>;
	packageGates?: Record<string, unknown>;
	overrides: Record<string, unknown>;
}) => {
	const config: Record<string, unknown> = { gates, 'gate-overrides': overrides };

	if (packageGates) {
		config['package-gates'] = packageGates;
	}

	return { config };
};

test('LightsoutConfig: an override may name a gate from either gate block, and nothing else', () => {
	const { config: fromEitherBlock } = setupConfig({
		gates: { check: 'pnpm check', test: 'pnpm test', 'test-coverage': 'pnpm test:cov', 'test-e2e': 'pnpm test:e2e' },
		packageGates: { check: 'pnpm -F {package} check', test: 'pnpm -F {package} test', 'test-browser': 'pnpm -F {package} test:browser' },
		// 'check' comes from the root block, 'test-browser' only from the scoped
		// one — an override is keyed by checkpoint, not by package, so a scoped
		// suite must not have to be written into the root block as well
		overrides: { 'verify-tests': ['check', 'test-browser', 'test-e2e'] },
	});
	const { config: namingNothing } = setupConfig({
		gates: { check: 'pnpm check', test: 'pnpm test', 'test-coverage': 'pnpm test:cov', 'test-e2e': 'pnpm test:e2e' },
		packageGates: { check: 'pnpm -F {package} check', test: 'pnpm -F {package} test', 'test-browser': 'pnpm -F {package} test:browser' },
		overrides: { 'verify-tests': ['check', 'test-smoke'] },
	});

	const accepted = LightsoutConfig.safeParse(fromEitherBlock);
	const refused = LightsoutConfig.safeParse(namingNothing);

	// a name either block configures is legal, and the list survives parsing in
	// the order the file wrote it
	expect(accepted.success).toBe(true);
	expect(accepted.data?.['gate-overrides']).toStrictEqual({ 'verify-tests': ['check', 'test-browser', 'test-e2e'] });
	// a name no block configures is a suite that would never run, so it fails at
	// config read rather than silently scheduling nothing
	expect(refused.success).toBe(false);
	expect(refused.error?.message ?? '').toMatch(/unknown gate 'test-smoke' in gate-overrides\.verify-tests/);
});

test('LightsoutConfig: a coverage gate opted out with false is not a name an override may use', () => {
	const { config: optedOut } = setupConfig({
		gates: { check: 'pnpm check', test: 'pnpm test', 'test-coverage': false },
		overrides: { 'clean-slate': ['check', 'test-coverage'] },
	});
	const { config: configuredInScopedBlock } = setupConfig({
		gates: { check: 'pnpm check', test: 'pnpm test', 'test-coverage': false },
		packageGates: { check: 'pnpm -F {package} check', test: 'pnpm -F {package} test', 'test-coverage': 'pnpm -F {package} test:cov' },
		overrides: { 'clean-slate': ['check', 'test-coverage'] },
	});

	const refused = LightsoutConfig.safeParse(optedOut);
	const accepted = LightsoutConfig.safeParse(configuredInScopedBlock);

	// the literal false is the explicit opt-out, so the key being present does
	// not make it a gate this repo has — scheduling it would be a silent no-op
	expect(refused.success).toBe(false);
	expect(refused.error?.message ?? '').toMatch(/unknown gate 'test-coverage' in gate-overrides\.clean-slate/);
	// the same name is legal once a block configures a command for it
	expect(accepted.success).toBe(true);
	expect(accepted.data?.['gate-overrides']).toStrictEqual({ 'clean-slate': ['check', 'test-coverage'] });
});
