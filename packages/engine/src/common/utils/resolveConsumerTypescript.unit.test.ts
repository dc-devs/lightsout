import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { linkTypescript } from '@tests/helpers/linkTypescript';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';

test('resolveConsumerTypescript: a RELATIVE cwd resolves too (createRequire rejects relative paths — observed live with --cwd .)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-tsres-'));

	linkTypescript({ dir });

	const previousCwd = process.cwd();

	process.chdir(dir);

	try {
		// relative cwd must anchor to an absolute path before createRequire
		expect(typeof resolveConsumerTypescript({ cwd: '.' })?.createSourceFile).toBe('function');
		// absolute cwd resolves
		expect(typeof resolveConsumerTypescript({ cwd: dir })?.createSourceFile).toBe('function');
	} finally {
		process.chdir(previousCwd);
	}
});

test('resolveConsumerTypescript: a monorepo whose typescript lives only in a package resolves through that package', () => {
	const root = mkdtempSync(join(tmpdir(), 'lightsout-tsres-mono-'));

	mkdirSync(join(root, 'packages/.pnpm-cache'), { recursive: true });
	mkdirSync(join(root, 'packages/api'), { recursive: true });
	linkTypescript({ dir: join(root, 'packages/api') });

	// the root has no typescript — pnpm hoists nothing, so the packages walk is
	// the only thing that finds it (dot entries skipped)
	expect(typeof resolveConsumerTypescript({ cwd: root })?.createSourceFile).toBe('function');
});

test('resolveConsumerTypescript: a custom packagesDir is walked instead of the packages default', () => {
	const root = mkdtempSync(join(tmpdir(), 'lightsout-tsres-apps-'));

	mkdirSync(join(root, 'apps/admin'), { recursive: true });
	linkTypescript({ dir: join(root, 'apps/admin') });

	// the default packages dir does not exist here, so nothing resolves
	expect(resolveConsumerTypescript({ cwd: root })).toBe(undefined);
	expect(typeof resolveConsumerTypescript({ cwd: root, packagesDir: 'apps' })?.createSourceFile).toBe('function');
});

test('resolveConsumerTypescript: a repo with no typescript anywhere degrades to undefined rather than throwing', () => {
	const root = mkdtempSync(join(tmpdir(), 'lightsout-tsres-none-'));

	// JS-only consumers get an honest undefined — the AST tier degrades, the run
	// does not crash
	expect(resolveConsumerTypescript({ cwd: root })).toBe(undefined);
});
