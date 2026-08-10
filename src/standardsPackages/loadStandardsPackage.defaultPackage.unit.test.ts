import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { StandardsSet } from '@/contracts';
import { buildStandardsDocuments, loadStandardsPackage } from '@/standardsPackages';

/**
 * The package the plugin ships, loaded from disk exactly as a consumer's run
 * loads it. This is the only test that reads the real default package, so it is
 * where the shipped tree's shape is pinned: how many documents it carries, which
 * channels it offers, and that every rule claiming a check ships one.
 */
const setupDefaultPackage = async () => {
	// `standards/`, not its build copy under plugin/ — a test that read the copy
	// would pass or fail on whether someone had run `pnpm bundle`.
	const pkg = await loadStandardsPackage({ packagePath: join(process.cwd(), 'standards') });

	return { pkg };
};

describe('loadStandardsPackage', () => {
	test('carries all 23 shipped documents, split across the code and tests trees', async () => {
		const { pkg } = await setupDefaultPackage();

		expect(pkg.name).toBe('lightsout-defaults');
		expect(pkg.documents).toHaveLength(23);
		expect(pkg.documents.filter((document) => document.set === StandardsSet.Code)).toHaveLength(20);
		expect(pkg.documents.filter((document) => document.set === StandardsSet.Tests)).toHaveLength(3);
	});

	test('offers exactly the base, react, and tanstack channels', async () => {
		const { pkg } = await setupDefaultPackage();

		// a channel no document declares could never be activated by a repo
		expect([...new Set(pkg.documents.map((document) => document.channel))].sort()).toStrictEqual(['base', 'react', 'tanstack']);
	});

	test('every rule declaring a check ships one that can be run', async () => {
		const { pkg } = await setupDefaultPackage();

		const checked = pkg.rules.filter((rule) => rule.checked);
		const runnable = checked.filter((rule) => typeof rule.run === 'function' && rule.inputKind !== undefined);

		// the honesty rule at load time is what makes this hold — this pins that it holds for the shipped package
		expect(checked.length).toBeGreaterThan(0);
		expect(runnable).toHaveLength(checked.length);
		// a judgment-only rule declares no check and carries none
		expect(pkg.rules.filter((rule) => !rule.checked).every((rule) => rule.run === undefined)).toBe(true);
	});

	test('assembles both sets for a repo running no framework, each document headed by where it came from', async () => {
		const { pkg } = await setupDefaultPackage();

		const { code, tests } = buildStandardsDocuments({ pkg, channels: [] });

		expect(code?.match(/^<!-- lightsout-defaults: code\/.+ -->$/gm)).toHaveLength(17);
		expect(tests?.match(/^<!-- lightsout-defaults: tests\/.+ -->$/gm)).toHaveLength(2);
		// the prose itself rides along, not just the headers
		expect(code ?? '').toContain('One Export Per File');
		expect(tests ?? '').toContain('Module Boundary Testing');
	});

	test('brings the framework documents in for a repo that runs them, after the base ones', async () => {
		const { pkg } = await setupDefaultPackage();

		const { code, tests } = buildStandardsDocuments({ pkg, channels: ['react', 'tanstack'] });

		// 17 base + 2 react + 1 tanstack on the code side; 2 base + 1 react on the tests side
		expect(code?.match(/^<!-- lightsout-defaults: code\/.+ -->$/gm)).toHaveLength(20);
		expect(tests?.match(/^<!-- lightsout-defaults: tests\/.+ -->$/gm)).toHaveLength(3);
		// channel documents land after every base one
		expect(code?.indexOf('<!-- lightsout-defaults: code/architecture/react -->')).toBeGreaterThan(
			code?.indexOf('<!-- lightsout-defaults: code/style-guide/typescript/type-assertions -->') ?? 0,
		);
	});
});
