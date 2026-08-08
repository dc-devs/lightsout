import { expect, test } from '@jest/globals';
import { StandardsRule, type StandardsFinding } from '@/contracts';
import { batchFindings } from '@/refactor';

const finding = ({ rule, path, siteKey }: { rule: StandardsFinding['rule']; path: string; siteKey: string }): StandardsFinding => ({
	rule,
	severity: 'finding',
	siteKey,
	files: [{ path }],
	detail: 'stub',
});

test('batchFindings: groups by rule × area, mechanical-first order', () => {
	const batches = batchFindings({
		findings: [
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
	expect(batches.map((batch) => `${batch.rule} ${batch.folder}`)).toStrictEqual(['module-boundary packages/api', 'module-boundary packages/web', 'multi-export (root)', 'multi-export src', 'clone packages/api']);
	expect(batches.every((batch, index) => batch.id.startsWith(`batch-${String(index + 1).padStart(2, '0')}:`))).toBeTruthy();
});

test('batchFindings: every rule batches in the documented mechanical-first order', () => {
	const batches = batchFindings({
		// Fed in the rule contract's own declaration order, which is NOT the
		// priority order — so the result pins the priority table rather than the
		// input, and a rule the table never named would fall to the end.
		findings: Object.values(StandardsRule).map((rule) => finding({ rule, path: 'src/a.ts', siteKey: `${rule}:src/a.ts` })),
		advisories: [],
		packagesDir: 'packages',
	});

	// rules an agent can fix in place first, judgment-heavier duplication last
	expect(batches.map((batch) => batch.rule)).toStrictEqual([
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
		'path-test-untested-subject-not-public',
		'test-multiple-setups',
		'test-mega-factory',
		'folder-census',
		'ast-duplicate',
		'clone',
		'name-duplicate',
		'name-synonym',
	]);
	// one batch per rule, numbered in that order — the ids an agent is handed
	expect(batches.map((batch) => batch.id).slice(0, 2)).toStrictEqual(['batch-01:path-banned-module-name:src', 'batch-02:path-common-flat:src']);
});

test('batchFindings: a rule outside the priority list sorts after every listed one', () => {
	const batches = batchFindings({
		findings: [
			// A rule id the priority list has never heard of — what a rule added to
			// the registry without a priority entry looks like here.
			{ ...finding({ rule: 'clone', path: 'src/stale.ts', siteKey: 'invented:stale' }), rule: 'invented-rule' as unknown as StandardsFinding['rule'] },
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

test('batchFindings: an oversized group splits into sorted chunks of 12', () => {
	const findings = Array.from({ length: 13 }, (_, index) =>
		finding({ rule: 'clone', path: `src/file${index}.ts`, siteKey: `clone:${String(index).padStart(2, '0')}` }),
	);
	const batches = batchFindings({ findings, advisories: [], packagesDir: 'packages' });

	expect(batches.length).toBe(2);
	expect(batches[0]?.findings.length).toBe(12);
	expect(batches[1]?.findings.length).toBe(1);
	// chunks split in site-key order
	expect(batches[1]?.findings[0]?.siteKey).toBe('clone:12');
});

test('batchFindings: advisories attach to batches whose files overlap, never form batches', () => {
	const advisory: StandardsFinding = { ...finding({ rule: 'size-function', path: 'src/a.ts', siteKey: 'size-function:src/a.ts' }), severity: 'advisory' };
	const batches = batchFindings({
		findings: [
			finding({ rule: 'clone', path: 'src/a.ts', siteKey: 'clone:a' }),
			finding({ rule: 'clone', path: 'lib/b.ts', siteKey: 'clone:b' }),
		],
		advisories: [advisory],
		packagesDir: 'packages',
	});

	expect(batches.length).toBe(2);
	expect(batches.find((batch) => batch.folder === 'src')?.advisories.length).toBe(1);
	expect(batches.find((batch) => batch.folder === 'lib')?.advisories.length).toBe(0);
});

test('batchFindings: a finding spanning folders gets a dedicated cross batch with every side in scope', () => {
	const batches = batchFindings({
		findings: [
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
	expect(cross?.findings.map((entry) => entry.siteKey)).toStrictEqual(['clone:x']);
	// cross batches run after single-folder batches of the same rule
	expect(batches.at(-1)?.folder).toBe('(cross)');
});

test('batchFindings: a finding naming no file still batches, under (root)', () => {
	const batches = batchFindings({
		findings: [{ ...finding({ rule: 'folder-census', path: 'src/a.ts', siteKey: 'folder-census:src' }), files: [] }],
		advisories: [],
		packagesDir: 'packages',
	});

	// a file-less finding has no area to group by — it degrades to (root) rather
	// than an undefined folder in the batch id an agent is handed
	expect(batches.map((batch) => batch.id)).toStrictEqual(['batch-01:folder-census:(root)']);
});
