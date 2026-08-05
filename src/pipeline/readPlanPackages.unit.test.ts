import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LightsoutConfig } from '@/contracts';
import { readPlanPackages, scanPlanPackagePaths } from '@/pipeline';

test('readPlanPackages parses the block-list form', () => {
	const plan = '---\npackages:\n  - backend-api\n  - "shared"\n---\n# Plan\n';

	assert.deepEqual(readPlanPackages({ planContent: plan }), ['backend-api', 'shared']);
});

test('readPlanPackages parses the inline form', () => {
	const plan = "---\npackages: [backend-api, 'web']\n---\n# Plan\n";

	assert.deepEqual(readPlanPackages({ planContent: plan }), ['backend-api', 'web']);
});

test('readPlanPackages returns undefined without front-matter, key, or entries', () => {
	assert.equal(readPlanPackages({ planContent: '# Plan: no front-matter\n' }), undefined);
	assert.equal(readPlanPackages({ planContent: '---\ntitle: x\n---\n# Plan\n' }), undefined);
	assert.equal(readPlanPackages({ planContent: '---\npackages: []\n---\n# Plan\n' }), undefined);
});

test('readPlanPackages stops the block list at the first non-entry line', () => {
	const plan = '---\npackages:\n  - api\n  - web\ntitle: something\n  - too-late\n---\n# Plan\n';

	assert.deepEqual(readPlanPackages({ planContent: plan }), ['api', 'web']);
});

test('readPlanPackages returns undefined for a packages key with no block entries', () => {
	assert.equal(readPlanPackages({ planContent: '---\npackages:\ntitle: x\n---\n# Plan\n' }), undefined);
});

test('readPlanPackages parses CRLF front-matter', () => {
	const plan = '---\r\npackages:\r\n  - api\r\n---\r\n# Plan\r\n';

	assert.deepEqual(readPlanPackages({ planContent: plan }), ['api']);
});

test('readPlanPackages drops empty entries from the inline form', () => {
	const plan = "---\npackages: [api, , 'web']\n---\n# Plan\n";

	assert.deepEqual(readPlanPackages({ planContent: plan }), ['api', 'web']);
});

test('scanPlanPackagePaths derives deduped scope from concrete paths', () => {
	const plan = 'Edit `packages/api/src/index.js` and packages/api/src/other.js plus packages/web/app.tsx... wait, packages/web/src/x.ts.';

	assert.deepEqual(scanPlanPackagePaths({ planContent: plan, packagesDir: 'packages' }), ['api', 'web']);
});

test('scanPlanPackagePaths respects word boundaries and packagesDir', () => {
	assert.equal(scanPlanPackagePaths({ planContent: 'see mypackages/foo/bar.ts', packagesDir: 'packages' }), undefined);
	assert.deepEqual(scanPlanPackagePaths({ planContent: 'edit apps/web/src/a.ts', packagesDir: 'apps' }), ['web']);
	assert.equal(scanPlanPackagePaths({ planContent: 'no paths here', packagesDir: 'packages' }), undefined);
});

test('scanPlanPackagePaths treats regex characters in packagesDir literally', () => {
	assert.deepEqual(scanPlanPackagePaths({ planContent: 'edit apps.v2/web/src/x.ts', packagesDir: 'apps.v2' }), ['web']);
	assert.equal(scanPlanPackagePaths({ planContent: 'edit appsXv2/web/src/x.ts', packagesDir: 'apps.v2' }), undefined);
});

const baseScripts = { check: 'true', testUnit: 'true', testCoverage: false };

test('config rejects a packageScripts command missing {package}', () => {
	const parsed = LightsoutConfig.safeParse({
		scripts: baseScripts,
		packageScripts: { check: 'pnpm typecheck', testUnit: 'pnpm --filter {package} test' },
	});

	assert.equal(parsed.success, false);
	assert.ok(JSON.stringify(!parsed.success && parsed.error.issues).includes('{package}'));
});

test('config accepts packageScripts with the placeholder everywhere', () => {
	const parsed = LightsoutConfig.safeParse({
		scripts: baseScripts,
		packageScripts: { check: 'pnpm --filter {package} typecheck', testUnit: 'pnpm --filter {package} test' },
	});

	assert.equal(parsed.success, true);
});

test('config requires testCoverage: a command or an explicit false', () => {
	assert.equal(LightsoutConfig.safeParse({ scripts: { check: 'true', testUnit: 'true' } }).success, false);
	assert.equal(LightsoutConfig.safeParse({ scripts: { ...baseScripts, testCoverage: 'pnpm cov' } }).success, true);
	assert.equal(LightsoutConfig.safeParse({ scripts: baseScripts }).success, true);
});
