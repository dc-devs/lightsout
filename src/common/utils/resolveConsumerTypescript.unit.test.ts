import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import { linkTypescript } from '@tests/helpers/linkTypescript';

test('resolveConsumerTypescript: a RELATIVE cwd resolves too (createRequire rejects relative paths — observed live with --cwd .)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-tsres-'));

	linkTypescript({ dir });

	const previousCwd = process.cwd();

	process.chdir(dir);

	try {
		assert.equal(typeof resolveConsumerTypescript({ cwd: '.' })?.createSourceFile, 'function', 'relative cwd must anchor to an absolute path before createRequire');
		assert.equal(typeof resolveConsumerTypescript({ cwd: dir })?.createSourceFile, 'function', 'absolute cwd resolves');
	} finally {
		process.chdir(previousCwd);
	}
});

test('resolveConsumerTypescript: a monorepo whose typescript lives only in a package resolves through that package', () => {
	const root = mkdtempSync(join(tmpdir(), 'lightsout-tsres-mono-'));

	mkdirSync(join(root, 'packages/.pnpm-cache'), { recursive: true });
	mkdirSync(join(root, 'packages/api'), { recursive: true });
	linkTypescript({ dir: join(root, 'packages/api') });

	assert.equal(
		typeof resolveConsumerTypescript({ cwd: root })?.createSourceFile,
		'function',
		'the root has no typescript — pnpm hoists nothing, so the packages walk is the only thing that finds it (dot entries skipped)',
	);
});

test('resolveConsumerTypescript: a custom packagesDir is walked instead of the packages default', () => {
	const root = mkdtempSync(join(tmpdir(), 'lightsout-tsres-apps-'));

	mkdirSync(join(root, 'apps/admin'), { recursive: true });
	linkTypescript({ dir: join(root, 'apps/admin') });

	assert.equal(resolveConsumerTypescript({ cwd: root }), undefined, 'the default packages dir does not exist here, so nothing resolves');
	assert.equal(typeof resolveConsumerTypescript({ cwd: root, packagesDir: 'apps' })?.createSourceFile, 'function');
});

test('resolveConsumerTypescript: a repo with no typescript anywhere degrades to undefined rather than throwing', () => {
	const root = mkdtempSync(join(tmpdir(), 'lightsout-tsres-none-'));

	assert.equal(resolveConsumerTypescript({ cwd: root }), undefined, 'JS-only consumers get an honest undefined — the AST tier degrades, the run does not crash');
});
