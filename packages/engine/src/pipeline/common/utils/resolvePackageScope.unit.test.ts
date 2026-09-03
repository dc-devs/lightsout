import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type LightsoutConfig, PackagesSource } from '#src/contracts/index.ts';
import { resolvePackageScope } from '#src/pipeline/common/utils/resolvePackageScope.ts';

const monorepo: LightsoutConfig = {
	gates: { check: 'true', test: 'true', 'test-coverage': false },
	'package-gates': { check: 'pnpm --filter {package} check', test: 'pnpm --filter {package} test' },
};

const singleRepo: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const call = ({
	config = monorepo,
	current = [],
	packages,
	planContent = '# Plan\n',
	knownPackages = [],
}: Partial<Parameters<typeof resolvePackageScope>[0]> = {}) =>
	resolvePackageScope({ config, current, packages, planContent, packagesDir: 'packages', knownPackages });

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

	test('an empty listing of known packages reconciles nothing', () => {
		const resolved = call({ planContent: '# Plan\nEdit `packages/billing/src/index.ts`.\n', knownPackages: [] });

		// an empty list means the workspace is unknown, not that it is empty —
		// acting on it would stop runs that work today
		expect(resolved).toStrictEqual({ scope: { packages: ['billing'], packagesSource: PackagesSource.PlanPaths } });
	});

	test('names read out of the plan body are filtered down to the packages that exist', () => {
		const resolved = call({
			planContent: '# Plan\nEdit `packages/billing/src/index.ts` and `packages/ghost/src/x.ts`.\n',
			knownPackages: ['billing', 'web'],
		});

		expect('error' in resolved ? undefined : resolved.scope).toStrictEqual({ packages: ['billing'], packagesSource: PackagesSource.PlanPaths });
	});

	test('a real package the plan mentions only as context is kept, not dropped', () => {
		const resolved = call({ planContent: '# Plan\nFor context, see `packages/web/src/app.tsx`.\n', knownPackages: ['billing', 'web'] });

		// over-inclusion just runs extra gates, and that is the only direction that
		// was ever safe — the filter removes fiction, it is not a whitelist
		expect(resolved).toStrictEqual({ scope: { packages: ['web'], packagesSource: PackagesSource.PlanPaths } });
	});

	test('a filtered-out name from the plan body comes back so the run can record it', () => {
		const resolved = call({
			planContent: '# Plan\nEdit `packages/billing/src/index.ts` and `packages/ghost/src/x.ts`.\n',
			knownPackages: ['billing', 'web'],
		});

		expect(resolved.ignored).toStrictEqual(['ghost']);
	});

	test('a plan body naming only packages that do not exist stops the run', () => {
		const resolved = call({ planContent: '# Plan\nEdit `packages/ghost/src/x.ts`.\n', knownPackages: ['billing', 'web'] });

		// an empty scope would run no gates at all, which proves nothing
		expect('error' in resolved && resolved.error).toContain('package-gates is configured but no package scope could be resolved');
		expect('error' in resolved && resolved.error).toContain('add a `packages:` list to the plan front-matter');
		expect('error' in resolved && resolved.error).toContain('pass --packages <a,b>');
		expect('error' in resolved && resolved.error).toContain('reference concrete packages/<name>/ paths');
	});

	test('the names dropped from an all-fiction plan body still come back', () => {
		const resolved = call({ planContent: '# Plan\nEdit `packages/ghost/src/x.ts`.\n', knownPackages: ['billing', 'web'] });

		// this is the run that most needs to say what it saw and rejected
		expect(resolved.ignored).toStrictEqual(['ghost']);
	});

	test('a --packages flag naming a package that does not exist stops the run and says what does', () => {
		const resolved = call({ packages: ['ghost'], knownPackages: ['billing', 'web'] });

		expect('error' in resolved && resolved.error).toBe('package scope names ghost — no such package under packages/. Packages that exist: billing, web.');
	});

	test('a front-matter list naming a package that does not exist fails the same way', () => {
		const resolved = call({ planContent: '---\npackages:\n  - ghost\n---\n# Plan\n', knownPackages: ['billing', 'web'] });

		// front-matter is a declaration a human wrote, not incidental prose
		expect('error' in resolved && resolved.error).toBe('package scope names ghost — no such package under packages/. Packages that exist: billing, web.');
	});

	test('a flag naming only real packages resolves with nothing ignored', () => {
		const resolved = call({ packages: ['billing'], knownPackages: ['billing', 'web'] });

		expect(resolved).toStrictEqual({ scope: { packages: ['billing'], packagesSource: PackagesSource.Flag } });
	});

	test('settling scope reads nothing from disk', () => {
		const source = readFileSync(join(__dirname, 'resolvePackageScope.ts'), 'utf8');

		// the direct route and the borrowed one: common/workspace/ is where every
		// filesystem-reading workspace helper lives, the new package lister included
		expect(source).not.toContain('node:fs');
		expect(source).not.toContain('#src/common/workspace/');
	});
});
