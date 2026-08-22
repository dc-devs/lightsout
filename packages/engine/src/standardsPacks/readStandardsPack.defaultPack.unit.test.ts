import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { StandardsSet } from '#src/contracts/index.ts';
import { buildStandardsDocuments, readStandardsPack } from '#src/standardsPacks/index.ts';

/**
 * The pack the plugin ships, loaded from disk exactly as a consumer's run
 * loads it. This is the only test that reads the real default pack, so it is
 * where the shipped tree's shape is pinned: how many documents it carries, which
 * channels it offers, and that every rule claiming a check ships one.
 */
const setupDefaultPack = async () => {
	// The authored pack, not its build copy under plugin/ — a test that read
	// the copy would pass or fail on whether someone had run `pnpm bundle`.
	//
	// Anchored on this file rather than on process.cwd(): the working directory
	// depends on where the runner was invoked from, which is exactly the sort of
	// thing that changes when a repo grows a second place to run tests from.
	const packPath = join(__dirname, '..', '..', '..', 'standards-typescript');

	return { pack: await readStandardsPack({ packPath }) };
};

describe('readStandardsPack', () => {
	test('carries all 23 shipped documents, split across the code and tests trees', async () => {
		const { pack } = await setupDefaultPack();

		expect(pack.name).toBe('lightsout-defaults');
		expect(pack.documents).toHaveLength(23);
		expect(pack.documents.filter((document) => document.set === StandardsSet.Code)).toHaveLength(20);
		expect(pack.documents.filter((document) => document.set === StandardsSet.Tests)).toHaveLength(3);
	});

	test('offers exactly the base, react, and tanstack channels', async () => {
		const { pack } = await setupDefaultPack();

		// a channel no document declares could never be activated by a repo
		expect([...new Set(pack.documents.map((document) => document.channel))].sort()).toStrictEqual(['base', 'react', 'tanstack']);
	});

	test('every rule declaring a check ships one that can be run', async () => {
		const { pack } = await setupDefaultPack();

		const checked = pack.rules.filter((rule) => rule.checked);
		const runnable = checked.filter((rule) => typeof rule.run === 'function' && rule.inputKind !== undefined);

		// the honesty rule at load time is what makes this hold — this pins that it holds for the shipped pack
		expect(checked.length).toBeGreaterThan(0);
		expect(runnable).toHaveLength(checked.length);
		// a judgment-only rule declares no check and carries none
		expect(pack.rules.filter((rule) => !rule.checked).every((rule) => rule.run === undefined)).toBe(true);
	});

	test('assembles both sets for a repo running no framework, each document headed by where it came from', async () => {
		const { pack } = await setupDefaultPack();

		const { code, tests } = buildStandardsDocuments({ pack, channels: [] });

		expect(code?.match(/^<!-- lightsout-defaults: code\/.+ -->$/gm)).toHaveLength(17);
		expect(tests?.match(/^<!-- lightsout-defaults: tests\/.+ -->$/gm)).toHaveLength(2);
		// the prose itself rides along, not just the headers
		expect(code ?? '').toContain('One Export Per File');
		expect(tests ?? '').toContain('Module Boundary Testing');
	});

	test('brings the framework documents in for a repo that runs them, after the base ones', async () => {
		const { pack } = await setupDefaultPack();

		const { code, tests } = buildStandardsDocuments({ pack, channels: ['react', 'tanstack'] });

		// 17 base + 2 react + 1 tanstack on the code side; 2 base + 1 react on the tests side
		expect(code?.match(/^<!-- lightsout-defaults: code\/.+ -->$/gm)).toHaveLength(20);
		expect(tests?.match(/^<!-- lightsout-defaults: tests\/.+ -->$/gm)).toHaveLength(3);
		// channel documents land after every base one
		expect(code?.indexOf('<!-- lightsout-defaults: code/architecture/react -->')).toBeGreaterThan(
			code?.indexOf('<!-- lightsout-defaults: code/style-guide/typescript/type-assertions -->') ?? 0,
		);
	});
});
