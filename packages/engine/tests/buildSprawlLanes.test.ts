import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from '@jest/globals';
import { runSprawlDriver } from '#tests/helpers/sprawl/runSprawlDriver.ts';
import { seedSprawlRepo } from '#tests/helpers/sprawl/seedSprawlRepo.ts';

// The counterfactual the hero animation is built on: the same commits with
// every graduation undone, so the file that split keeps growing at the path it
// left. The two lanes have to differ by exactly one variable, which is why the
// "without" lane is replayed from real history rather than invented.

interface Tree {
	files: Record<string, number>;
	folders: Record<string, number>;
}

interface LaneState {
	files: Record<string, number>;
	folders: Record<string, number>;
	overCap: number;
}

const caps = { file: 100, tsxFile: 120 };
const repos: string[] = [];

const setupLanes = ({ trees }: { trees: Tree[] }) => {
	const cwd = seedSprawlRepo();

	repos.push(cwd);

	return { cwd, trees, caps };
};

const buildLanes = ({ cwd, trees, caps }: { cwd: string; trees: Tree[]; caps: { file: number; tsxFile: number } }) =>
	runSprawlDriver<{ withStates: LaneState[]; withoutStates: LaneState[] }>({
		cwd,
		body: [
			"import { buildSprawlLanes } from './scripts/buildSprawlLanes.mjs';",
			'',
			`const input = ${JSON.stringify({ trees, caps })};`,
			'const measured = input.trees.map((tree) => ({ files: new Map(Object.entries(tree.files)), folders: new Map(Object.entries(tree.folders)) }));',
			'const lanes = buildSprawlLanes({ trees: measured, caps: input.caps });',
			'const dump = (states) =>',
			'\tstates.map((state) => ({ files: Object.fromEntries(state.files), folders: Object.fromEntries(state.folders), overCap: state.overCap }));',
			'',
			'report({ withStates: dump(lanes.withStates), withoutStates: dump(lanes.withoutStates) });',
		].join('\n'),
	});

afterAll(() => {
	for (const cwd of repos) {
		rmSync(join(cwd, '..'), { recursive: true, force: true });
	}
});

describe('buildSprawlLanes', () => {
	test('leaves the two lanes identical over a history where nothing split', () => {
		const input = setupLanes({
			trees: [
				{ files: { 'packages/app/src/a.ts': 10 }, folders: { 'packages/app/src': 1 } },
				{ files: { 'packages/app/src/a.ts': 20 }, folders: { 'packages/app/src': 1 } },
			],
		});

		const lanes = buildLanes(input);

		expect(lanes.withoutStates).toStrictEqual(lanes.withStates);
	});

	test('sums a graduated folder back into the file it came out of, and hands the parent folder its file back', () => {
		const input = setupLanes({
			trees: [
				{ files: { 'packages/app/src/big.ts': 100, 'packages/app/src/other.ts': 10 }, folders: { 'packages/app/src': 2 } },
				{
					files: { 'packages/app/src/big/index.ts': 20, 'packages/app/src/big/part.ts': 90, 'packages/app/src/other.ts': 10 },
					folders: { 'packages/app/src': 1, 'packages/app/src/big': 2 },
				},
			],
		});

		const lanes = buildLanes(input);

		expect(lanes.withoutStates[1]).toStrictEqual({
			files: { 'packages/app/src/other.ts': 10, 'packages/app/src/big.ts': 110 },
			folders: { 'packages/app/src': 2 },
			overCap: 1,
		});
	});

	test('treats a deletion beside a folder that was already there as a deletion, not as a split', () => {
		const input = setupLanes({
			trees: [
				{ files: { 'packages/app/src/x.ts': 40, 'packages/app/src/x/index.ts': 5 }, folders: { 'packages/app/src': 1, 'packages/app/src/x': 1 } },
				{ files: { 'packages/app/src/x/index.ts': 5 }, folders: { 'packages/app/src/x': 1 } },
			],
		});

		const lanes = buildLanes(input);

		expect(lanes.withoutStates[1]).toStrictEqual(lanes.withStates[1]);
	});

	test('treats a file replaced by a same-stem folder with no barrel as a deletion, not as a split', () => {
		const input = setupLanes({
			trees: [
				{ files: { 'packages/app/src/x.ts': 40 }, folders: { 'packages/app/src': 1 } },
				{ files: { 'packages/app/src/x/part.ts': 38 }, folders: { 'packages/app/src/x': 1 } },
			],
		});

		const lanes = buildLanes(input);

		expect(lanes.withoutStates[1]).toStrictEqual(lanes.withStates[1]);
	});

	test('counts a split inside an already-undone folder once, in the outer sum', () => {
		const input = setupLanes({
			trees: [
				{ files: { 'packages/app/src/big.ts': 100 }, folders: { 'packages/app/src': 1 } },
				{ files: { 'packages/app/src/big/index.ts': 10, 'packages/app/src/big/inner.ts': 90 }, folders: { 'packages/app/src/big': 2 } },
				{
					files: { 'packages/app/src/big/index.ts': 10, 'packages/app/src/big/inner/index.ts': 40, 'packages/app/src/big/inner/more.ts': 60 },
					folders: { 'packages/app/src/big': 1, 'packages/app/src/big/inner': 2 },
				},
			],
		});

		const lanes = buildLanes(input);

		expect(lanes.withoutStates[2]).toStrictEqual({ files: { 'packages/app/src/big.ts': 110 }, folders: { 'packages/app/src': 1 }, overCap: 1 });
	});

	test('drops the substitution when the folder it was summing is deleted, rather than holding a path nobody has', () => {
		const input = setupLanes({
			trees: [
				{ files: { 'packages/app/src/big.ts': 100, 'packages/app/src/other.ts': 10 }, folders: { 'packages/app/src': 2 } },
				{
					files: { 'packages/app/src/big/index.ts': 20, 'packages/app/src/big/part.ts': 90, 'packages/app/src/other.ts': 10 },
					folders: { 'packages/app/src': 1, 'packages/app/src/big': 2 },
				},
				{ files: { 'packages/app/src/other.ts': 10 }, folders: { 'packages/app/src': 1 } },
			],
		});

		const lanes = buildLanes(input);

		expect(lanes.withoutStates[2]).toStrictEqual({ files: { 'packages/app/src/other.ts': 10 }, folders: { 'packages/app/src': 1 }, overCap: 0 });
	});

	test('holds a .tsx file to the wider tsx cap and a .ts file of the same length to the narrower one', () => {
		const input = setupLanes({
			trees: [{ files: { 'packages/app/src/wide.tsx': 110, 'packages/app/src/narrow.ts': 110 }, folders: { 'packages/app/src': 2 } }],
		});

		const lanes = buildLanes(input);

		expect(lanes.withStates[0].overCap).toBe(1);
	});
});
