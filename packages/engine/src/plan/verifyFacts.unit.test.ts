import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { ExploreArea } from '#src/contracts/index.ts';
import { verifyFacts } from '#src/plan/index.ts';

/** A full ExploreArea with per-test overrides. */
const area = (overrides: Partial<ExploreArea>): ExploreArea => ({
	area: 'core',
	affectedPackages: [],
	filesToModify: [],
	patternsToMirror: [],
	integrationPoints: [],
	scripts: [],
	namingConvention: 'kebab',
	...overrides,
});

test('verifyFacts: present vs missing paths and scripts, counts correct', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-verify-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/present.ts'), '');
	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ scripts: { check: 'tsc', test: 'node --test' } }));

	const result = await verifyFacts({
		cwd,
		facts: {
			request: 'x',
			areas: [
				area({
					filesToModify: [
						{ path: 'src/present.ts', role: 'the file to change' },
						{ path: 'src/gone.ts', role: 'does not exist' },
					],
					patternsToMirror: [{ path: 'src/present.ts', takeaway: 'mirror its shape' }],
					scripts: [
						{ key: 'check', command: 'tsc' },
						{ key: 'build', command: 'tsc -b' },
					],
				}),
			],
		},
	});

	// two files-to-modify + one pattern
	expect(result.pathsChecked).toBe(3);
	expect(result.missingPaths).toStrictEqual(['src/gone.ts']);
	expect(result.scriptsChecked).toBe(2);
	// present 'check' not flagged, absent 'build' is
	expect(result.missingScripts).toStrictEqual(['build']);
	// create-path checking is deferred to draft
	expect(result.createPathsThatExist).toStrictEqual([]);
});

test('verifyFacts: a script found in an affected package is not a miss', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-verify-pkg-'));

	mkdirSync(join(cwd, 'packages/engine'), { recursive: true });
	// Root package.json lacks the key; the affected package supplies it.
	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ scripts: {} }));
	writeFileSync(join(cwd, 'packages/engine/package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));

	const result = await verifyFacts({
		cwd,
		facts: {
			request: 'x',
			areas: [area({ affectedPackages: ['packages/engine'], scripts: [{ key: 'test', command: 'node --test' }] })],
		},
	});

	// the key resolves against the affected package.json
	expect(result.missingScripts).toStrictEqual([]);
	expect(result.scriptsChecked).toBe(1);
});

test('verifyFacts: never throws when no package.json exists — script is simply a miss', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-verify-empty-'));

	const result = await verifyFacts({
		cwd,
		facts: { request: 'x', areas: [area({ scripts: [{ key: 'check', command: 'tsc' }] })] },
	});

	expect(result.missingScripts).toStrictEqual(['check']);
	expect(result.pathsChecked).toBe(0);
});

test('verifyFacts: an unparsable package.json contributes no script keys — the script is a miss', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-verify-badjson-'));

	writeFileSync(join(cwd, 'package.json'), 'not json {');

	const result = await verifyFacts({
		cwd,
		facts: { request: 'x', areas: [area({ scripts: [{ key: 'check', command: 'tsc' }] })] },
	});

	// a manifest that fails to parse offers no keys
	expect(result.missingScripts).toStrictEqual(['check']);
	expect(result.scriptsChecked).toBe(1);
});

test('verifyFacts: a scripts field that is not an object contributes no script keys', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-verify-scriptsnotobj-'));

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ scripts: 'not-an-object' }));

	const result = await verifyFacts({
		cwd,
		facts: { request: 'x', areas: [area({ scripts: [{ key: 'check', command: 'tsc' }] })] },
	});

	// a non-object scripts field offers no keys
	expect(result.missingScripts).toStrictEqual(['check']);
	expect(result.scriptsChecked).toBe(1);
});

test('verifyFacts: a package.json without a scripts block contributes no script keys', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-verify-noscripts-'));

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer' }));

	const result = await verifyFacts({
		cwd,
		facts: { request: 'x', areas: [area({ scripts: [{ key: 'check', command: 'tsc' }] })] },
	});

	// no scripts block means no available keys
	expect(result.missingScripts).toStrictEqual(['check']);
	expect(result.scriptsChecked).toBe(1);
});

test('verifyFacts: an area with no scripts checks paths only — zero scripts checked', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-verify-noscriptarea-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/present.ts'), '');

	const result = await verifyFacts({
		cwd,
		facts: { request: 'x', areas: [area({ filesToModify: [{ path: 'src/present.ts', role: 'the file to change' }] })] },
	});

	expect(result.scriptsChecked).toBe(0);
	expect(result.missingScripts).toStrictEqual([]);
	expect(result.pathsChecked).toBe(1);
});
