import { expect, test } from '@jest/globals';
import type { StandardsFinding } from '#src/contracts/index.ts';
import { batchFindings } from '#src/refactor/batch/index.ts';

/** Every rule the shipped standards package names, in the order batching is meant to hand them to an agent. */
const mechanicalFirstOrder = [
	'path-banned-module-name',
	'path-common-flat',
	'path-common-barrel',
	'path-test-in-tests-folder',
	'path-test-not-colocated',
	'path-test-support-in-src',
	'module-boundary',
	'placement',
	'multi-export',
	'filename-mismatch',
	'test-mock-prefix',
	'test-mock-return-in-hook',
	'test-mock-untyped',
	'test-mock-wrapper-untyped',
	'test-shared-let',
	'test-assert-in-hook',
	'test-nested-describe',
	'test-manual-mock-cleanup',
	'test-strict-equal-matcher',
	'barrel-star',
	'barrel-dead-entry',
	'dead-export',
	'test-only-export',
	'barrel-only-export',
	'size-file',
	'size-function',
	'domain-graduation',
	'path-domain-folder-single-file',
	'path-folder-casing',
	'test-multiple-setups',
	'test-mega-factory',
	'folder-census',
	'ast-duplicate',
	'clone',
	'name-duplicate',
	'name-synonym',
];

const finding = ({ rule, path, siteKey }: { rule: StandardsFinding['rule']; path: string; siteKey: string }): StandardsFinding => ({
	rule,
	severity: 'blocking',
	siteKey,
	files: [{ path }],
	detail: 'stub',
});

test('batchFindings: groups by rule × area, mechanical-first order', () => {
	const batches = batchFindings({
		blocking: [
			finding({ rule: 'clone', path: 'packages/api/src/a.ts', siteKey: 'clone:1' }),
			finding({ rule: 'module-boundary', path: 'packages/api/src/b.ts', siteKey: 'boundary:b' }),
			finding({ rule: 'module-boundary', path: 'packages/web/src/c.ts', siteKey: 'boundary:c' }),
			finding({ rule: 'multi-export', path: 'src/d.ts', siteKey: 'multi-export:d' }),
			finding({ rule: 'multi-export', path: 'loose.ts', siteKey: 'multi-export:loose' }),
		],
		advisories: [],
		packagesDir: 'packages',
	});

	// boundary before multi-export before clone; package dirs, top segments, and
	// (root) as areas
	expect(batches.map((batch) => `${batch.rule} ${batch.folder}`)).toStrictEqual([
		'module-boundary packages/api',
		'module-boundary packages/web',
		'multi-export (root)',
		'multi-export src',
		'clone packages/api',
	]);
	// the ids an agent is handed: a running number in that same order
	expect(batches.map((batch) => batch.id)).toStrictEqual([
		'batch-01:module-boundary:packages/api',
		'batch-02:module-boundary:packages/web',
		'batch-03:multi-export:(root)',
		'batch-04:multi-export:src',
		'batch-05:clone:packages/api',
	]);
});

test('batchFindings: every rule batches in the documented mechanical-first order', () => {
	const batches = batchFindings({
		// Fed alphabetically, which is NOT the priority order — so the result pins
		// the priority table rather than the input, and a rule the table never
		// named would fall to the end.
		blocking: [...mechanicalFirstOrder].sort().map((rule) => finding({ rule, path: 'src/a.ts', siteKey: `${rule}:src/a.ts` })),
		advisories: [],
		packagesDir: 'packages',
	});

	// rules an agent can fix in place first, judgment-heavier duplication last
	expect(batches.map((batch) => batch.rule)).toStrictEqual(mechanicalFirstOrder);
	// one batch per rule, numbered in that order — the ids an agent is handed
	expect(batches.map((batch) => batch.id).slice(0, 2)).toStrictEqual(['batch-01:path-banned-module-name:src', 'batch-02:path-common-flat:src']);
});

test('batchFindings: a rule outside the priority list sorts after every listed one', () => {
	const batches = batchFindings({
		blocking: [
			// A rule id the priority list has never heard of — what a rule a
			// standards package added without a priority entry looks like here.
			finding({ rule: 'invented-rule', path: 'src/stale.ts', siteKey: 'invented:stale' }),
			finding({ rule: 'clone', path: 'src/a.ts', siteKey: 'clone:a' }),
			finding({ rule: 'module-boundary', path: 'src/b.ts', siteKey: 'boundary:b' }),
		],
		advisories: [],
		packagesDir: 'packages',
	});

	// an unlisted rule degrades to "after the known ones" — never to an error,
	// and never ahead of the mechanical work
	expect(batches.map((batch) => batch.rule)).toStrictEqual(['module-boundary', 'clone', 'invented-rule']);
});

test('batchFindings: rules outside the priority list tie-break alphabetically, and their ids reach the batch id', () => {
	const batches = batchFindings({
		// Rule ids a loaded standards package names for itself — the priority
		// list has no say over which ids exist, so several can share the
		// unlisted priority at once and only the id breaks the tie.
		blocking: [
			finding({ rule: 'zeta-package-rule', path: 'src/z.ts', siteKey: 'zeta:z' }),
			finding({ rule: 'alpha-package-rule', path: 'src/a.ts', siteKey: 'alpha:a' }),
			finding({ rule: 'clone', path: 'src/c.ts', siteKey: 'clone:c' }),
		],
		advisories: [],
		packagesDir: 'packages',
	});

	// every listed rule first, then the unlisted ones in id order
	expect(batches.map((batch) => batch.id)).toStrictEqual(['batch-01:clone:src', 'batch-02:alpha-package-rule:src', 'batch-03:zeta-package-rule:src']);
});

test('batchFindings: an oversized group splits into sorted chunks of 12', () => {
	const findings = Array.from({ length: 13 }, (_, index) =>
		finding({ rule: 'clone', path: `src/file${index}.ts`, siteKey: `clone:${String(index).padStart(2, '0')}` }),
	);
	const batches = batchFindings({ blocking: findings, advisories: [], packagesDir: 'packages' });

	expect(batches.length).toBe(2);
	expect(batches[0]?.blocking.length).toBe(12);
	expect(batches[1]?.blocking.length).toBe(1);
	// chunks split in site-key order
	expect(batches[1]?.blocking[0]?.siteKey).toBe('clone:12');
});

test('batchFindings: each chunk of an oversized group takes its own batch number', () => {
	const findings = Array.from({ length: 25 }, (_, index) =>
		finding({ rule: 'clone', path: `src/file${index}.ts`, siteKey: `clone:${String(index).padStart(2, '0')}` }),
	);

	const batches = batchFindings({ blocking: findings, advisories: [], packagesDir: 'packages' });

	// one group, three chunks — the numbering runs across chunks, not per group,
	// so no two jobs an agent is handed share an id
	expect(batches.map((batch) => batch.id)).toStrictEqual(['batch-01:clone:src', 'batch-02:clone:src', 'batch-03:clone:src']);
});

test('batchFindings: an advisory attaches only to the chunk holding its file', () => {
	const findings = Array.from({ length: 13 }, (_, index) =>
		finding({ rule: 'clone', path: `src/file${index}.ts`, siteKey: `clone:${String(index).padStart(2, '0')}` }),
	);
	const advisory: StandardsFinding = { ...finding({ rule: 'size-file', path: 'src/file12.ts', siteKey: 'size-file:src/file12.ts' }), severity: 'advisory' };

	const batches = batchFindings({ blocking: findings, advisories: [advisory], packagesDir: 'packages' });

	// the overlap is per chunk, not per group: file12 lands in the second chunk,
	// so the first chunk carries none of its advisories
	expect(batches.map((batch) => batch.advisories.map((entry) => entry.siteKey))).toStrictEqual([[], ['size-file:src/file12.ts']]);
});

test('batchFindings: paths that name no package folder fall back to their top segment, or (root)', () => {
	const batches = batchFindings({
		blocking: [
			// A file sitting directly in the packages dir names no package, so the
			// dir itself is the area.
			finding({ rule: 'clone', path: 'packages/loose.ts', siteKey: 'clone:loose' }),
			// An absolute path has an empty first segment — no area to name.
			finding({ rule: 'clone', path: '/abs/file.ts', siteKey: 'clone:abs' }),
		],
		advisories: [],
		packagesDir: 'packages',
	});

	expect(batches.map((batch) => batch.id)).toStrictEqual(['batch-01:clone:(root)', 'batch-02:clone:packages']);
});

test('batchFindings: advisories attach to batches whose files overlap, never form batches', () => {
	const advisory: StandardsFinding = { ...finding({ rule: 'size-function', path: 'src/a.ts', siteKey: 'size-function:src/a.ts' }), severity: 'advisory' };
	const batches = batchFindings({
		blocking: [finding({ rule: 'clone', path: 'src/a.ts', siteKey: 'clone:a' }), finding({ rule: 'clone', path: 'lib/b.ts', siteKey: 'clone:b' })],
		advisories: [advisory],
		packagesDir: 'packages',
	});

	expect(batches.length).toBe(2);
	expect(batches.find((batch) => batch.folder === 'src')?.advisories.length).toBe(1);
	expect(batches.find((batch) => batch.folder === 'lib')?.advisories.length).toBe(0);
});

test('batchFindings: a finding spanning folders gets a dedicated cross batch with every side in scope', () => {
	const batches = batchFindings({
		blocking: [
			finding({ rule: 'clone', path: 'packages/api/src/a.ts', siteKey: 'clone:a' }),
			{
				...finding({ rule: 'clone', path: 'packages/api/src/b.ts', siteKey: 'clone:x' }),
				files: [{ path: 'packages/api/src/b.ts' }, { path: 'packages/web/src/c.ts' }],
			},
		],
		advisories: [],
		packagesDir: 'packages',
	});

	const cross = batches.find((batch) => batch.folder === '(cross)');

	// multi-folder finding forms its own (cross) batch
	expect(cross).toBeTruthy();
	expect(cross?.blocking.map((entry) => entry.siteKey)).toStrictEqual(['clone:x']);
	// cross batches run after single-folder batches of the same rule
	expect(batches.at(-1)?.folder).toBe('(cross)');
});

test('batchFindings: a finding naming no file still batches, under (root)', () => {
	const batches = batchFindings({
		blocking: [{ ...finding({ rule: 'folder-census', path: 'src/a.ts', siteKey: 'folder-census:src' }), files: [] }],
		advisories: [],
		packagesDir: 'packages',
	});

	// a file-less finding has no area to group by — it degrades to (root) rather
	// than an undefined folder in the batch id an agent is handed
	expect(batches.map((batch) => batch.id)).toStrictEqual(['batch-01:folder-census:(root)']);
});
