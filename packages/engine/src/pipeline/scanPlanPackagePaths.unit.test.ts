// Split out of readPlanPackages.unit.test.ts so the subject and its test file
// share a name: the test-promotion rules pair them by filename, and cases for
// scanPlanPackagePaths living under another function's name read as a barrel
// entry nothing tests.

import { expect, test } from '@jest/globals';
import { LightsoutConfig } from '#src/contracts/index.ts';
import { readPlanPackages, scanPlanPackagePaths } from '#src/pipeline/index.ts';

test('readPlanPackages parses the block-list form', () => {
	const plan = '---\npackages:\n  - backend-api\n  - "shared"\n---\n# Plan\n';

	expect(readPlanPackages({ planContent: plan })).toStrictEqual(['backend-api', 'shared']);
});

test('readPlanPackages parses the inline form', () => {
	const plan = "---\npackages: [backend-api, 'web']\n---\n# Plan\n";

	expect(readPlanPackages({ planContent: plan })).toStrictEqual(['backend-api', 'web']);
});

test('readPlanPackages returns undefined without front-matter, key, or entries', () => {
	expect(readPlanPackages({ planContent: '# Plan: no front-matter\n' })).toBe(undefined);
	expect(readPlanPackages({ planContent: '---\ntitle: x\n---\n# Plan\n' })).toBe(undefined);
	expect(readPlanPackages({ planContent: '---\npackages: []\n---\n# Plan\n' })).toBe(undefined);
});

test('readPlanPackages stops the block list at the first non-entry line', () => {
	const plan = '---\npackages:\n  - api\n  - web\ntitle: something\n  - too-late\n---\n# Plan\n';

	expect(readPlanPackages({ planContent: plan })).toStrictEqual(['api', 'web']);
});

test('readPlanPackages returns undefined for a packages key with no block entries', () => {
	expect(readPlanPackages({ planContent: '---\npackages:\ntitle: x\n---\n# Plan\n' })).toBe(undefined);
});

test('readPlanPackages parses CRLF front-matter', () => {
	const plan = '---\r\npackages:\r\n  - api\r\n---\r\n# Plan\r\n';

	expect(readPlanPackages({ planContent: plan })).toStrictEqual(['api']);
});

test('readPlanPackages drops empty entries from the inline form', () => {
	const plan = "---\npackages: [api, , 'web']\n---\n# Plan\n";

	expect(readPlanPackages({ planContent: plan })).toStrictEqual(['api', 'web']);
});

test('scanPlanPackagePaths derives deduped scope from concrete paths', () => {
	const plan = 'Edit `packages/api/src/index.js` and packages/api/src/other.js plus packages/web/app.tsx... wait, packages/web/src/x.ts.';

	expect(scanPlanPackagePaths({ planContent: plan, packagesDir: 'packages' })).toStrictEqual(['api', 'web']);
});

test('scanPlanPackagePaths respects word boundaries and packagesDir', () => {
	expect(scanPlanPackagePaths({ planContent: 'see mypackages/foo/bar.ts', packagesDir: 'packages' })).toBe(undefined);
	expect(scanPlanPackagePaths({ planContent: 'edit apps/web/src/a.ts', packagesDir: 'apps' })).toStrictEqual(['web']);
	expect(scanPlanPackagePaths({ planContent: 'no paths here', packagesDir: 'packages' })).toBe(undefined);
});

test('scanPlanPackagePaths treats regex characters in packagesDir literally', () => {
	expect(scanPlanPackagePaths({ planContent: 'edit apps.v2/web/src/x.ts', packagesDir: 'apps.v2' })).toStrictEqual(['web']);
	expect(scanPlanPackagePaths({ planContent: 'edit appsXv2/web/src/x.ts', packagesDir: 'apps.v2' })).toBe(undefined);
});

const baseGates = { check: 'true', test: 'true', 'test-coverage': false };

test('config rejects a packageGates command missing {package}', () => {
	const parsed = LightsoutConfig.safeParse({
		gates: baseGates,
		'package-gates': { check: 'pnpm typecheck', test: 'pnpm --filter {package} test' },
	});

	expect(parsed.success).toBe(false);
	expect(JSON.stringify(!parsed.success && parsed.error.issues).includes('{package}')).toBeTruthy();
});

test('config accepts packageGates with the placeholder everywhere', () => {
	const parsed = LightsoutConfig.safeParse({
		gates: baseGates,
		'package-gates': { check: 'pnpm --filter {package} typecheck', test: 'pnpm --filter {package} test' },
	});

	expect(parsed.success).toBe(true);
});

test('config requires test-coverage: a command or an explicit false', () => {
	expect(LightsoutConfig.safeParse({ gates: { check: 'true', test: 'true' } }).success).toBe(false);
	expect(LightsoutConfig.safeParse({ gates: { ...baseGates, 'test-coverage': 'pnpm cov' } }).success).toBe(true);
	expect(LightsoutConfig.safeParse({ gates: baseGates }).success).toBe(true);
});
