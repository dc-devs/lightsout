import { describe, expect, test } from '@jest/globals';
import { groupFindingsByFolder } from '#src/features/standards/index.ts';
import { buildStandardsFinding } from '#tests/helpers/buildStandardsFinding.ts';

describe('groupFindingsByFolder', () => {
	test('buckets a finding under the folder its file sits in, with the file name dropped', () => {
		const groups = groupFindingsByFolder({ findings: [buildStandardsFinding()], depth: 4 });

		expect(groups).toStrictEqual([{ folder: 'packages/engine/src/plan', count: 1, rules: [{ rule: 'size-file', count: 1 }] }]);
	});

	test('decides the bucket from the first file, since that is the site the rule reported', () => {
		const groups = groupFindingsByFolder({
			findings: [buildStandardsFinding({ paths: ['packages/engine/src/plan/draftPlan.ts', 'packages/web-app/src/routes/index.tsx'] })],
			depth: 4,
		});

		expect(groups[0].folder).toBe('packages/engine/src/plan');
	});

	test('keeps the last segment of a folder site, which a structure rule reports without a file name', () => {
		const groups = groupFindingsByFolder({ findings: [buildStandardsFinding({ rule: 'placement', paths: ['packages/engine/src/plan'] })], depth: 4 });

		expect(groups[0].folder).toBe('packages/engine/src/plan');
	});

	test('cuts a deep path to the chosen depth, which is what makes the dial worth having', () => {
		const groups = groupFindingsByFolder({ findings: [buildStandardsFinding()], depth: 3 });

		expect(groups[0].folder).toBe('packages/engine/src');
	});

	test('uses a path shorter than the depth whole rather than padding it', () => {
		const groups = groupFindingsByFolder({ findings: [buildStandardsFinding({ paths: ['scripts/copyStandards.mjs'] })], depth: 4 });

		expect(groups[0].folder).toBe('scripts');
	});

	test('buckets a file at the repo root under the root itself', () => {
		const groups = groupFindingsByFolder({ findings: [buildStandardsFinding({ paths: ['biome.jsonc'] })], depth: 4 });

		expect(groups[0].folder).toBe('.');
	});

	test('buckets a finding that names no file at all under the root, rather than losing it', () => {
		const groups = groupFindingsByFolder({ findings: [buildStandardsFinding({ paths: [] })], depth: 4 });

		expect(groups).toStrictEqual([{ folder: '.', count: 1, rules: [{ rule: 'size-file', count: 1 }] }]);
	});

	test('puts the largest bucket first, which is the whole point of looking', () => {
		const groups = groupFindingsByFolder({
			findings: [
				buildStandardsFinding({ paths: ['packages/web-app/src/routes/index.tsx'] }),
				buildStandardsFinding({ paths: ['packages/engine/src/plan/a.ts'] }),
				buildStandardsFinding({ paths: ['packages/engine/src/plan/b.ts'] }),
			],
			depth: 4,
		});

		expect(groups.map(({ folder, count }) => ({ folder, count }))).toStrictEqual([
			{ folder: 'packages/engine/src/plan', count: 2 },
			{ folder: 'packages/web-app/src/routes', count: 1 },
		]);
	});

	test('breaks a tie on the folder name, so the same findings always render in the same order', () => {
		const groups = groupFindingsByFolder({
			findings: [buildStandardsFinding({ paths: ['b/one.ts'] }), buildStandardsFinding({ paths: ['a/one.ts'] })],
			depth: 4,
		});

		expect(groups.map(({ folder }) => folder)).toStrictEqual(['a', 'b']);
	});

	test('names the rules behind a bucket, most findings first', () => {
		const groups = groupFindingsByFolder({
			findings: [
				buildStandardsFinding({ rule: 'size-file', paths: ['packages/engine/src/plan/a.ts'] }),
				buildStandardsFinding({ rule: 'clone', paths: ['packages/engine/src/plan/b.ts'] }),
				buildStandardsFinding({ rule: 'clone', paths: ['packages/engine/src/plan/c.ts'] }),
			],
			depth: 4,
		});

		expect(groups[0].rules).toStrictEqual([
			{ rule: 'clone', count: 2 },
			{ rule: 'size-file', count: 1 },
		]);
	});

	test('breaks a rule tie on the rule id, for the same reason folders break theirs', () => {
		const groups = groupFindingsByFolder({
			findings: [
				buildStandardsFinding({ rule: 'size-file', paths: ['packages/engine/src/plan/a.ts'] }),
				buildStandardsFinding({ rule: 'clone', paths: ['packages/engine/src/plan/b.ts'] }),
			],
			depth: 4,
		});

		expect(groups[0].rules.map(({ rule }) => rule)).toStrictEqual(['clone', 'size-file']);
	});

	test('answers an empty report with an empty breakdown', () => {
		const groups = groupFindingsByFolder({ findings: [], depth: 4 });

		expect(groups).toStrictEqual([]);
	});
});
