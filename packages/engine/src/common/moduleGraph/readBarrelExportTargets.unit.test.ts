import { expect, test } from '@jest/globals';
import { createSpecifierResolver } from '#src/common/moduleGraph/createSpecifierResolver.ts';
import { readBarrelExportTargets } from '#src/common/moduleGraph/readBarrelExportTargets.ts';

// Runtime require rather than a static import: the CJS TypeScript compiler
// probes __filename at load, so it has to be required at runtime rather than
// pulled into the module graph. ts-jest transpiles this file to CommonJS, where
// `require` is already the local resolver — `import.meta` does not exist there.
const ts = require('typescript') as typeof import('typescript');

const files = ['src/mod/index.ts', 'src/mod/feature.ts', 'src/mod/types/Config.ts'];
const resolve = createSpecifierResolver({ files });

test('readBarrelExportTargets: named, aliased, star, and type re-exports contribute their resolved targets; local exports contribute nothing', () => {
	const { targets, complete } = readBarrelExportTargets({
		path: 'src/mod/index.ts',
		content: [
			"export { feature } from './feature';",
			"export type { Config } from '@/mod/types/Config';",
			"export * from './feature';",
			'export const local = 1;',
		].join('\n'),
		compiler: ts,
		resolve,
	});

	expect([...targets].sort()).toStrictEqual(['src/mod/feature.ts', 'src/mod/types/Config.ts']);
	// every specifier was placed — the surface is whole
	expect(complete).toBe(true);
});

test('readBarrelExportTargets: bare external package specifiers cost nothing, but any other unresolved specifier leaves the surface incomplete', () => {
	const external = readBarrelExportTargets({
		path: 'src/mod/index.ts',
		content: "export { useState } from 'react';\nexport { z } from '@scope/pkg';\nexport { feature } from './feature';",
		compiler: ts,
		resolve,
	});

	// externals can never name a repo file, so absence-arguments still stand
	expect(external.complete).toBe(true);
	expect([...external.targets]).toStrictEqual(['src/mod/feature.ts']);

	const unplaced = readBarrelExportTargets({
		path: 'src/mod/index.ts',
		content: "export { ghost } from './ghost';",
		compiler: ts,
		resolve,
	});

	// a specifier this pass could not place makes the surface unreadable
	expect(unplaced.complete).toBe(false);
});

test('readBarrelExportTargets: a .tsx barrel is parsed under the JSX flavor, so the re-exports beneath its JSX still land', () => {
	const { targets, complete } = readBarrelExportTargets({
		path: 'src/mod/index.tsx',
		content: ['export const Badge = () => <span className="badge" />;', "export { Widget } from './Widget';"].join('\n'),
		compiler: ts,
		resolve: createSpecifierResolver({ files: ['src/mod/index.tsx', 'src/mod/Widget.tsx'] }),
	});

	// the JSX statement parses as JSX instead of derailing the statement after it
	expect([...targets]).toStrictEqual(['src/mod/Widget.tsx']);
	expect(complete).toBe(true);
});

test('readBarrelExportTargets: an export with no module specifier names no file, and does not make the surface unreadable', () => {
	const { targets, complete } = readBarrelExportTargets({
		path: 'src/mod/index.ts',
		content: ['const local = 1;', 'export { local };', "export { feature } from './feature';"].join('\n'),
		compiler: ts,
		resolve,
	});

	// a local re-export points at nothing to place — only the specifier does
	expect([...targets]).toStrictEqual(['src/mod/feature.ts']);
	expect(complete).toBe(true);
});

test('readBarrelExportTargets: a barrel re-exporting through package-imports specifiers places every target it names', () => {
	const { targets, complete } = readBarrelExportTargets({
		path: 'src/mod/index.ts',
		content: ["export { feature } from '#src/mod/feature.ts';", "export type { Config } from '#src/mod/types/Config.ts';"].join('\n'),
		compiler: ts,
		resolve,
	});

	// the shape every barrel in this repo now writes — the alias root plus the
	// extension the target really carries, since nothing probes it for you
	expect([...targets].sort()).toStrictEqual(['src/mod/feature.ts', 'src/mod/types/Config.ts']);
	expect(complete).toBe(true);
});

test('readBarrelExportTargets: an unplaceable package-imports specifier leaves the surface incomplete rather than passing as an external package', () => {
	const { complete } = readBarrelExportTargets({
		path: 'src/mod/index.ts',
		content: "export { ghost } from '#src/mod/ghost.ts';",
		compiler: ts,
		resolve,
	});

	// a '#'-rooted specifier always names a file in this very repo, so failing to
	// place one is a hole in the surface — only a published package resolves to
	// nothing for free
	expect(complete).toBe(false);
});
