import { expect, test } from '@jest/globals';
import type { StandardsFinding } from '@/contracts';
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
			finding({ rule: 'structure', path: 'src/d.ts', siteKey: 'multi-export:d' }),
			finding({ rule: 'structure', path: 'loose.ts', siteKey: 'multi-export:loose' }),
		],
		advisories: [],
		packagesDir: 'packages',
	});

	// boundary before structure before clone; package dirs, top segments, and
	// (root) as areas
	expect(batches.map((batch) => `${batch.rule} ${batch.folder}`)).toStrictEqual(['module-boundary packages/api', 'module-boundary packages/web', 'structure (root)', 'structure src', 'clone packages/api']);
	expect(batches.every((batch, index) => batch.id.startsWith(`batch-${String(index + 1).padStart(2, '0')}:`))).toBeTruthy();
});

test('batchFindings: a rule outside the priority list sorts after every listed one', () => {
	const batches = batchFindings({
		findings: [
			finding({ rule: 'dead-export', path: 'src/stale.ts', siteKey: 'dead:stale' }),
			finding({ rule: 'clone', path: 'src/a.ts', siteKey: 'clone:a' }),
			finding({ rule: 'module-boundary', path: 'src/b.ts', siteKey: 'boundary:b' }),
		],
		advisories: [],
		packagesDir: 'packages',
	});

	// an unlisted rule degrades to "after the known ones" — never to an error,
	// and never ahead of the mechanical work
	expect(batches.map((batch) => batch.rule)).toStrictEqual(['module-boundary', 'clone', 'dead-export']);
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
	const advisory: StandardsFinding = { ...finding({ rule: 'size', path: 'src/a.ts', siteKey: 'size:fn:a' }), severity: 'advisory' };
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
		findings: [{ ...finding({ rule: 'structure', path: 'src/a.ts', siteKey: 'census:src' }), files: [] }],
		advisories: [],
		packagesDir: 'packages',
	});

	// a file-less finding has no area to group by — it degrades to (root) rather
	// than an undefined folder in the batch id an agent is handed
	expect(batches.map((batch) => batch.id)).toStrictEqual(['batch-01:structure:(root)']);
});
