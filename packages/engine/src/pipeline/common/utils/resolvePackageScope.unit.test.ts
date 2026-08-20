import { describe, expect, test } from '@jest/globals';
import { type LightsoutConfig, PackagesSource } from '#src/contracts/index.ts';
import { resolvePackageScope } from '#src/pipeline/common/utils/resolvePackageScope.ts';

const monorepo: LightsoutConfig = {
	gates: { check: 'true', test: 'true', 'test-coverage': false },
	'package-gates': { check: 'pnpm --filter {package} check', test: 'pnpm --filter {package} test' },
};

const singleRepo: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const call = ({ config = monorepo, current = [], packages, planContent = '# Plan\n' }: Partial<Parameters<typeof resolvePackageScope>[0]> = {}) =>
	resolvePackageScope({ config, current, packages, planContent, packagesDir: 'packages' });

describe('resolvePackageScope', () => {
	test('a single-repo config has no package scope to settle', () => {
		expect(call({ config: singleRepo })).toStrictEqual({});
	});

	test('a resume keeps the scope the manifest already recorded', () => {
		// re-deriving it could widen or narrow a run halfway through
		expect(call({ current: ['api'] })).toStrictEqual({});
	});

	test('the flag wins over everything the plan says', () => {
		const resolved = call({ packages: ['api'], planContent: '---\npackages:\n  - web\n---\n# Plan\n' });

		expect(resolved).toStrictEqual({ scope: { packages: ['api'], packagesSource: PackagesSource.Flag } });
	});

	test('the plan front-matter is used when no flag was passed', () => {
		const resolved = call({ planContent: '---\npackages:\n  - web\n---\n# Plan\n' });

		expect(resolved).toStrictEqual({ scope: { packages: ['web'], packagesSource: PackagesSource.FrontMatter } });
	});

	test('concrete package paths in the plan body are the last resort before failing', () => {
		const resolved = call({ planContent: '# Plan\nEdit `packages/billing/src/index.ts` and add the hook.\n' });

		// over-inclusion only runs extra gates; under-inclusion is caught later by
		// scope expansion, so reading the body is safe in this direction
		expect(resolved).toStrictEqual({ scope: { packages: ['billing'], packagesSource: PackagesSource.PlanPaths } });
	});

	test('a monorepo run that can name no scope stops instead of guessing', () => {
		const resolved = call({ planContent: '# Plan\nNothing concrete here.\n' });

		expect('error' in resolved && resolved.error).toContain('package-gates is configured but no package scope could be resolved');
	});

	test('an empty --packages flag stops the run instead of falling back to the plan', () => {
		const resolved = call({ packages: [], planContent: '---\npackages:\n  - web\n---\n# Plan\n' });

		// passing the flag at all means the caller settled scope; an empty list is a
		// caller mistake, not permission to re-derive scope from the plan
		expect('error' in resolved && resolved.error).toContain('package-gates is configured but no package scope could be resolved');
	});
});
