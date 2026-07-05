import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ExploreArea } from '@lightsout/contracts';
import { verifyFacts } from '../src/index';

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
		report: {
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

	assert.equal(result.pathsChecked, 3, 'two files-to-modify + one pattern');
	assert.deepEqual(result.missingPaths, ['src/gone.ts']);
	assert.equal(result.scriptsChecked, 2);
	assert.deepEqual(result.missingScripts, ['build'], "present 'check' not flagged, absent 'build' is");
	assert.deepEqual(result.createPathsThatExist, [], 'create-path checking is deferred to draft');
});

test('verifyFacts: a script found in an affected package is not a miss', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-verify-pkg-'));

	mkdirSync(join(cwd, 'packages/engine'), { recursive: true });
	// Root package.json lacks the key; the affected package supplies it.
	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ scripts: {} }));
	writeFileSync(join(cwd, 'packages/engine/package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));

	const result = await verifyFacts({
		cwd,
		report: {
			areas: [area({ affectedPackages: ['packages/engine'], scripts: [{ key: 'test', command: 'node --test' }] })],
		},
	});

	assert.deepEqual(result.missingScripts, [], 'the key resolves against the affected package.json');
	assert.equal(result.scriptsChecked, 1);
});

test('verifyFacts: never throws when no package.json exists — script is simply a miss', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-verify-empty-'));

	const result = await verifyFacts({
		cwd,
		report: { areas: [area({ scripts: [{ key: 'check', command: 'tsc' }] })] },
	});

	assert.deepEqual(result.missingScripts, ['check']);
	assert.equal(result.pathsChecked, 0);
});
