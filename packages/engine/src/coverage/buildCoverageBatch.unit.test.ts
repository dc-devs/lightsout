import { describe, expect, test } from '@jest/globals';
import type { CoverageFile } from '#src/contracts/index.ts';
import { buildCoverageBatch } from '#src/coverage/buildCoverageBatch.ts';

const file = ({ path, statementsPct, scope = 'root' }: { path: string; statementsPct: number; scope?: string }): CoverageFile => ({
	path,
	scope,
	statementsPct,
});

describe('buildCoverageBatch', () => {
	test('takes whole components worst-first until the tracked-candidate target is met', () => {
		const files = [
			file({ path: 'src/a/one.ts', statementsPct: 5 }),
			file({ path: 'src/b/three.ts', statementsPct: 20 }),
			file({ path: 'src/c/five.ts', statementsPct: 30 }),
			file({ path: 'src/d/six.ts', statementsPct: 40 }),
		];
		const components = [['src/a/one.ts', 'src/a/two.ts'], ['src/b/three.ts', 'src/b/four.ts'], ['src/c/five.ts'], ['src/d/six.ts']];

		const batch = buildCoverageBatch({ files, components, batchNumber: 1, batchSize: 3 });

		// three components fill the target of three candidates; the fourth waits
		expect(batch.files.map((entry) => entry.path)).toStrictEqual(['src/a/one.ts', 'src/b/three.ts', 'src/c/five.ts']);
		expect(batch.members).toStrictEqual(['src/a/one.ts', 'src/a/two.ts', 'src/b/three.ts', 'src/b/four.ts', 'src/c/five.ts']);
	});

	test('a well-covered module member rides along in the writer list without being tracked for improvement', () => {
		const files = [file({ path: 'src/mod/internal.ts', statementsPct: 5 })];
		const components = [['src/mod/boundary.ts', 'src/mod/internal.ts']];

		const batch = buildCoverageBatch({ files, components, batchNumber: 1 });

		// the boundary is what the writer must test through, so it must be in its list
		expect(batch.members).toStrictEqual(['src/mod/boundary.ts', 'src/mod/internal.ts']);
		// but it is not what this batch is measured on
		expect(batch.files.map((entry) => entry.path)).toStrictEqual(['src/mod/internal.ts']);
	});

	test('the leading component is taken whole even when it alone exceeds the target', () => {
		const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name, index) => file({ path: `src/mod/${name}.ts`, statementsPct: index }));
		const components = [files.map((entry) => entry.path)];

		const batch = buildCoverageBatch({ files, components, batchNumber: 1, batchSize: 3 });

		// splitting the module would hand the writer internals without their boundary
		expect(batch.files.length).toBe(7);
		expect(batch.members.length).toBe(7);
	});

	test('a component above the writer cap splits into chunks, and the batch takes the one holding the worst file', () => {
		const members = Array.from({ length: 20 }, (_, index) => `src/mod/${String(index).padStart(2, '0')}.ts`);
		const files = [file({ path: 'src/mod/15.ts', statementsPct: 2 }), file({ path: 'src/mod/03.ts', statementsPct: 40 })];

		const batch = buildCoverageBatch({ files, components: [members], batchNumber: 1 });

		// chunks are sorted slices of 12 — the worst file sits in the second one
		expect(batch.members).toStrictEqual(members.slice(12));
		expect(batch.files.map((entry) => entry.path)).toStrictEqual(['src/mod/15.ts']);
	});

	test('without a consumer TypeScript the singleton components reduce to plain worst-first selection', () => {
		const files = [
			file({ path: 'src/c.ts', statementsPct: 1 }),
			file({ path: 'src/a.ts', statementsPct: 2 }),
			file({ path: 'src/b.ts', statementsPct: 3 }),
			file({ path: 'src/d.ts', statementsPct: 4 }),
			file({ path: 'src/e.ts', statementsPct: 5 }),
			file({ path: 'src/f.ts', statementsPct: 6 }),
		];

		const batch = buildCoverageBatch({ files, components: files.map((entry) => [entry.path]), batchNumber: 1 });

		expect(batch.files.map((entry) => entry.path)).toStrictEqual(['src/c.ts', 'src/a.ts', 'src/b.ts', 'src/d.ts', 'src/e.ts']);
	});

	test('two components whose worst file ties are ordered by path, so the same round picks the same work twice', () => {
		const files = [file({ path: 'src/z.ts', statementsPct: 10 }), file({ path: 'src/a.ts', statementsPct: 10 })];

		const batch = buildCoverageBatch({ files, components: [['src/z.ts'], ['src/a.ts']], batchNumber: 1, batchSize: 1 });

		expect(batch.members).toStrictEqual(['src/a.ts']);
	});

	test('the batch id carries a zero-padded number and the scope it belongs to', () => {
		const files = [file({ path: 'packages/api/src/a.ts', statementsPct: 5, scope: 'api' })];

		expect(buildCoverageBatch({ files, components: [['packages/api/src/a.ts']], batchNumber: 7 }).id).toBe('batch-07:api');
		// scope is taken from the worst file, which is where the run's work is
		expect(buildCoverageBatch({ files, components: [['packages/api/src/a.ts']], batchNumber: 12 }).scope).toBe('api');
		expect(buildCoverageBatch({ files, components: [['packages/api/src/a.ts']], batchNumber: 12 }).id).toBe('batch-12:api');
	});

	test('a component holding no candidate is passed over, however many files it has', () => {
		const files = [file({ path: 'src/a.ts', statementsPct: 5 })];

		const batch = buildCoverageBatch({ files, components: [['src/untouched.ts', 'src/other.ts'], ['src/a.ts']], batchNumber: 1 });

		// only files the round measured as short of the bar earn a writer
		expect(batch.members).toStrictEqual(['src/a.ts']);
	});

	test('a component above the writer cap that holds no candidate is passed over whole, never chunked', () => {
		const files = [file({ path: 'src/a.ts', statementsPct: 5 })];
		const covered = Array.from({ length: 20 }, (_, index) => `src/covered/${String(index).padStart(2, '0')}.ts`);

		const batch = buildCoverageBatch({ files, components: [covered, ['src/a.ts']], batchNumber: 1 });

		// with no candidate to chunk around there is no worst file to keep, so the
		// whole component is simply not this batch's work
		expect(batch.members).toStrictEqual(['src/a.ts']);
		expect(batch.files.map((entry) => entry.path)).toStrictEqual(['src/a.ts']);
	});
});
