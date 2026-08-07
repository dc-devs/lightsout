import { expect, describe, test } from '@jest/globals';
import type { LightsoutConfig } from '@/contracts';
import { resolvePlansDir } from '@/plan';

/**
 * A cwd plus the loaded config as `plan` sees it. `withConfig: false` is the
 * no-`lightsout.config.json` case, where the whole config is absent rather
 * than merely missing `plansDir`.
 */
const setupPlansDir = ({ plansDir, withConfig = true }: { plansDir?: string; withConfig?: boolean } = {}) => {
	const config: LightsoutConfig | undefined = withConfig
		? { scripts: { check: 'tsc --noEmit', testUnit: 'node --test', testCoverage: false }, plansDir }
		: undefined;

	return { cwd: '/repo', config };
};

describe('resolvePlansDir', () => {
	test('defaults to .claude/plans under cwd when neither the flag nor config names one', () => {
		const { cwd, config } = setupPlansDir();

		const plansDir = resolvePlansDir({ cwd, config });

		expect(plansDir).toBe('/repo/.claude/plans');
	});

	test('defaults to .claude/plans under cwd when no config was loaded at all', () => {
		const { cwd, config } = setupPlansDir({ withConfig: false });

		const plansDir = resolvePlansDir({ cwd, config });

		// an absent config resolves the same default as a config that omits plansDir
		expect(plansDir).toBe('/repo/.claude/plans');
	});

	test('resolves a relative config.plansDir against cwd', () => {
		const { cwd, config } = setupPlansDir({ plansDir: 'docs/plans' });

		const plansDir = resolvePlansDir({ cwd, config });

		expect(plansDir).toBe('/repo/docs/plans');
	});

	test('returns an absolute config.plansDir unchanged, leaving cwd out of it', () => {
		const { cwd, config } = setupPlansDir({ plansDir: '/srv/lightsout/plans' });

		const plansDir = resolvePlansDir({ cwd, config });

		expect(plansDir).toBe('/srv/lightsout/plans');
	});

	test('the --plans flag wins over a configured plansDir', () => {
		const { cwd, config } = setupPlansDir({ plansDir: 'docs/plans' });

		const plansDir = resolvePlansDir({ cwd, flag: 'tmp/plans', config });

		// the CLI override outranks the committed config
		expect(plansDir).toBe('/repo/tmp/plans');
	});

	test('the --plans flag wins over the default when no config was loaded', () => {
		const { cwd, config } = setupPlansDir({ withConfig: false });

		const plansDir = resolvePlansDir({ cwd, flag: 'plans', config });

		expect(plansDir).toBe('/repo/plans');
	});

	test('returns an absolute --plans flag unchanged, leaving cwd out of it', () => {
		const { cwd, config } = setupPlansDir({ plansDir: 'docs/plans' });

		const plansDir = resolvePlansDir({ cwd, flag: '/srv/override/plans', config });

		expect(plansDir).toBe('/srv/override/plans');
	});
});
