import { expect, test } from '@jest/globals';
import { LightsoutConfig } from '#src/contracts/index.ts';

// The cross-block name check — a gate from either block is legal, a gate from
// neither is not — is pinned in `LightsoutConfig.gateOverrides.unit.test.ts`
// beside this file. What this file adds is the rest of that check's behaviour
// through the composed config: a checkpoint written as `"off"` names no gate at
// all, gate keys that are never scheduled at a checkpoint leave the check
// alone, and the whole block stays opt-in.

const setupConfig = ({ gates, overrides }: { gates: Record<string, unknown>; overrides?: Record<string, unknown> }) => {
	const config: Record<string, unknown> = { gates };

	if (overrides) {
		config['gate-overrides'] = overrides;
	}

	return { config };
};

test('LightsoutConfig: a checkpoint written as "off" names no gate, so nothing of it is checked against the gate blocks', () => {
	const { config } = setupConfig({
		gates: { check: 'pnpm check', test: 'pnpm test', 'test-coverage': 'pnpm test:cov' },
		overrides: { 'clean-slate': 'off', 'verify-tests': ['check'] },
	});

	const parsed = LightsoutConfig.safeParse(config);

	// `"off"` is a string, not a list of names: read as one it would spell three
	// gates this repo does not configure, and the config would refuse to read
	expect(parsed.success).toBe(true);
	// both spellings survive the composition side by side, exactly as written
	expect(parsed.data?.['gate-overrides']).toStrictEqual({ 'clean-slate': 'off', 'verify-tests': ['check'] });
});

test('LightsoutConfig: gate keys that never run at a checkpoint leave an override alone', () => {
	const { config } = setupConfig({
		gates: { check: 'pnpm check', test: 'pnpm test', 'test-coverage': 'pnpm test:cov', generate: 'pnpm codegen', format: 'pnpm format' },
		overrides: { 'verify-implement': ['check', 'test-coverage'] },
	});

	const parsed = LightsoutConfig.safeParse(config);

	// `generate` runs before a checkpoint's gates and `format` once at the very
	// end, so neither is a gate an override may name — and a repo that configures
	// both still reads its override of the gates it can name
	expect(parsed.success).toBe(true);
	expect(parsed.data?.['gate-overrides']).toStrictEqual({ 'verify-implement': ['check', 'test-coverage'] });
});

test('LightsoutConfig: gate-overrides is opt-in — an absent block leaves no key on the parsed config', () => {
	const { config } = setupConfig({ gates: { check: 'pnpm check', test: 'pnpm test', 'test-coverage': false } });

	const parsed = LightsoutConfig.parse(config);

	// absence is what every existing config relies on for the engine's own
	// schedule: cheap gates first, expensive ones only once the cheap ones pass
	expect('gate-overrides' in parsed).toBe(false);
	expect(parsed['gate-overrides']).toBe(undefined);
});
