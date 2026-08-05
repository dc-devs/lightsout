import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScanFinding } from '@/contracts';
import { batchFindings } from '@/refactor';

const finding = ({ detector, path, cluster }: { detector: ScanFinding['detector']; path: string; cluster: string }): ScanFinding => ({
	detector,
	severity: 'finding',
	cluster,
	files: [{ path }],
	detail: 'stub',
});

test('batchFindings: groups by detector × area, mechanical-first order', () => {
	const batches = batchFindings({
		findings: [
			finding({ detector: 'clone', path: 'packages/api/src/a.ts', cluster: 'clone:1' }),
			finding({ detector: 'module-boundary', path: 'packages/api/src/b.ts', cluster: 'boundary:b' }),
			finding({ detector: 'module-boundary', path: 'packages/web/src/c.ts', cluster: 'boundary:c' }),
			finding({ detector: 'structure', path: 'src/d.ts', cluster: 'multi-export:d' }),
			finding({ detector: 'structure', path: 'loose.ts', cluster: 'multi-export:loose' }),
		],
		advisories: [],
		packagesDir: 'packages',
	});

	assert.deepEqual(
		batches.map((batch) => `${batch.detector} ${batch.folder}`),
		['module-boundary packages/api', 'module-boundary packages/web', 'structure (root)', 'structure src', 'clone packages/api'],
		'boundary before structure before clone; package dirs, top segments, and (root) as areas',
	);
	assert.ok(batches.every((batch, index) => batch.id.startsWith(`batch-${String(index + 1).padStart(2, '0')}:`)));
});

test('batchFindings: a detector outside the priority list sorts after every listed one', () => {
	const batches = batchFindings({
		findings: [
			finding({ detector: 'dead-export', path: 'src/stale.ts', cluster: 'dead:stale' }),
			finding({ detector: 'clone', path: 'src/a.ts', cluster: 'clone:a' }),
			finding({ detector: 'module-boundary', path: 'src/b.ts', cluster: 'boundary:b' }),
		],
		advisories: [],
		packagesDir: 'packages',
	});

	assert.deepEqual(
		batches.map((batch) => batch.detector),
		['module-boundary', 'clone', 'dead-export'],
		'an unlisted detector degrades to "after the known ones" — never to an error, and never ahead of the mechanical work',
	);
});

test('batchFindings: an oversized group splits into sorted chunks of 12', () => {
	const findings = Array.from({ length: 13 }, (_, index) =>
		finding({ detector: 'clone', path: `src/file${index}.ts`, cluster: `clone:${String(index).padStart(2, '0')}` }),
	);
	const batches = batchFindings({ findings, advisories: [], packagesDir: 'packages' });

	assert.equal(batches.length, 2);
	assert.equal(batches[0]?.findings.length, 12);
	assert.equal(batches[1]?.findings.length, 1);
	assert.equal(batches[1]?.findings[0]?.cluster, 'clone:12', 'chunks split in cluster order');
});

test('batchFindings: advisories attach to batches whose files overlap, never form batches', () => {
	const advisory: ScanFinding = { ...finding({ detector: 'size', path: 'src/a.ts', cluster: 'size:fn:a' }), severity: 'advisory' };
	const batches = batchFindings({
		findings: [
			finding({ detector: 'clone', path: 'src/a.ts', cluster: 'clone:a' }),
			finding({ detector: 'clone', path: 'lib/b.ts', cluster: 'clone:b' }),
		],
		advisories: [advisory],
		packagesDir: 'packages',
	});

	assert.equal(batches.length, 2);
	assert.equal(batches.find((batch) => batch.folder === 'src')?.advisories.length, 1);
	assert.equal(batches.find((batch) => batch.folder === 'lib')?.advisories.length, 0);
});

test('batchFindings: a finding spanning folders gets a dedicated cross batch with every side in scope', () => {
	const batches = batchFindings({
		findings: [
			finding({ detector: 'clone', path: 'packages/api/src/a.ts', cluster: 'clone:a' }),
			{
				...finding({ detector: 'clone', path: 'packages/api/src/b.ts', cluster: 'clone:x' }),
				files: [{ path: 'packages/api/src/b.ts' }, { path: 'packages/web/src/c.ts' }],
			},
		],
		advisories: [],
		packagesDir: 'packages',
	});

	const cross = batches.find((batch) => batch.folder === '(cross)');

	assert.ok(cross, 'multi-folder finding forms its own (cross) batch');
	assert.deepEqual(cross?.findings.map((entry) => entry.cluster), ['clone:x']);
	assert.equal(batches.at(-1)?.folder, '(cross)', 'cross batches run after single-folder batches of the same detector');
});
