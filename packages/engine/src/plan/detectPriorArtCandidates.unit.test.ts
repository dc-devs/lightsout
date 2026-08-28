import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { LightsoutConfig } from '#src/contracts/index.ts';
import { detectPriorArtCandidates } from '#src/plan/detectPriorArtCandidates.ts';

/** A temp repo with the given existing source files and a plan whose Files-to-Create/Delete/Move sections list the given paths. */
const setup = ({
	existing,
	creates,
	deletes = [],
	moves = [],
}: {
	existing: string[];
	creates: string[];
	deletes?: string[];
	moves?: Array<{ from: string; to: string }>;
}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-dedup-detect-'));

	for (const rel of existing) {
		const abs = join(cwd, rel);

		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, 'export const x = 1;\n');
	}

	const dir = join(cwd, '.lightsout', 'plans', 'p');

	mkdirSync(dir, { recursive: true });

	const createSection = `## Files to Create\n\n${creates.map((path) => `### \`${path}\`\n\nnew.\n`).join('\n')}\n`;
	const deleteSection = deletes.length === 0 ? '' : `## Files to Delete\n\n${deletes.map((path) => `### \`${path}\`\n\ngone.\n`).join('\n')}\n`;
	const moveSection = moves.length === 0 ? '' : `## Files to Move\n\n${moves.map(({ from, to }) => `### \`${from}\` → \`${to}\`\n\nmoved.\n`).join('\n')}\n`;
	const planPath = join(dir, 'plan.md');

	writeFileSync(planPath, `# Plan\n\n${createSection}\n${deleteSection}\n${moveSection}`);

	return { cwd, planPaths: [planPath] };
};

test('detectPriorArtCandidates: a synonym name-collision is a candidate', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	expect(candidates.length).toBe(1);
	expect(candidates[0]?.plannedSymbol).toBe('getUser');
	expect(candidates[0]?.plannedPath).toBe('src/getUser.ts');
	// the candidate carries the plan file that declared it, which is what the dedup
	// fan-out groups by
	expect(candidates[0]?.phase).toBe('plan.md');
	expect(candidates[0]?.collidesWith.some((collision) => collision.name === 'fetchUser')).toBeTruthy();
});

test('detectPriorArtCandidates: a phased plan tags each candidate with the phase file that declared it', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/fetchUser.ts', 'src/fetchOrder.ts'], creates: ['src/getUser.ts'] });
	const second = join(cwd, '.lightsout', 'plans', 'p', 'phase2-orders.md');

	writeFileSync(second, '# Plan\n\n## Files to Create\n\n### `src/getOrder.ts`\n\nnew.\n');

	const candidates = await detectPriorArtCandidates({ cwd, planPaths: [...planPaths, second] });

	// the dedup fan-out groups by this label, and `plannedPath` cannot supply it
	expect(candidates.map(({ plannedSymbol, phase }) => ({ plannedSymbol, phase }))).toStrictEqual([
		{ plannedSymbol: 'getUser', phase: 'plan.md' },
		{ plannedSymbol: 'getOrder', phase: 'phase2-orders.md' },
	]);
});

test('detectPriorArtCandidates: an exact name-collision is a candidate', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/parseThing.ts'], creates: ['src/other/parseThing.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	expect(candidates.length).toBe(1);
	expect(candidates[0]?.collidesWith.some((collision) => collision.path === 'src/parseThing.ts')).toBeTruthy();
});

test('detectPriorArtCandidates: a to/from inverse is not a candidate', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/rgbToHex.ts'], creates: ['src/hexToRgb.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	expect(candidates).toStrictEqual([]);
});

test('detectPriorArtCandidates: a component+route casing pair is not a candidate', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/GetStarted.tsx'], creates: ['src/get-started.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	expect(candidates).toStrictEqual([]);
});

test('detectPriorArtCandidates: a genuinely novel name yields no candidate', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/brandNewWidget.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	expect(candidates).toStrictEqual([]);
});

test('detectPriorArtCandidates: collisions against a test file or index.* are excluded', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/tests/getUser.ts', 'src/index.ts'], creates: ['src/getUser.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	expect(candidates).toStrictEqual([]);
});

test('detectPriorArtCandidates: a plan path that cannot be read is skipped, not fatal', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const ghost = join(cwd, '.lightsout', 'plans', 'ghost', 'plan.md');

	const candidates = await detectPriorArtCandidates({ cwd, planPaths: [ghost, ...planPaths] });

	// the readable plan still contributes its planned symbols
	expect(candidates.length).toBe(1);
	expect(candidates[0]?.plannedSymbol).toBe('getUser');
});

test('detectPriorArtCandidates: a planned index.* file is never a planned symbol', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/feature/index.ts', 'src/getUser.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	// a barrel carries no symbol of its own
	expect(candidates.map((candidate) => candidate.plannedSymbol)).toStrictEqual(['getUser']);
});

test('detectPriorArtCandidates: a planned path that already exists is not prior art against itself', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/getUser.ts'], creates: ['src/getUser.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	// the planned path is excluded from the census it is compared against
	expect(candidates).toStrictEqual([]);
});

test('detectPriorArtCandidates: a plan with no Files to Create yields no candidates', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/fetchUser.ts'], creates: [] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	expect(candidates).toStrictEqual([]);
});

test('detectPriorArtCandidates: a collision inside a configured generated path is excluded', async () => {
	const { cwd, planPaths } = setup({ existing: ['generated-src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const config = LightsoutConfig.parse({
		gates: { check: 'true', test: 'true', 'test-coverage': false },
		generated: ['generated-src/'],
	});

	const candidates = await detectPriorArtCandidates({ cwd, planPaths, config });

	// generated output is not prior art
	expect(candidates).toStrictEqual([]);
});

test('detectPriorArtCandidates: a shuffled word order is the same concept, so it is a candidate', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/userDataGet.ts'], creates: ['src/getUserData.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	expect(candidates.length).toBe(1);
	expect(candidates[0]?.collidesWith.some((collision) => collision.name === 'userDataGet')).toBeTruthy();
});

test('detectPriorArtCandidates: a from/to inverse is not a candidate', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/dtoFromEntity.ts'], creates: ['src/entityFromDto.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	expect(candidates).toStrictEqual([]);
});

test('detectPriorArtCandidates: a from-conversion keeps its order, so a synonym twin of it is still a candidate', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/loadRowsFromDisk.ts'], creates: ['src/fetchRowsFromDisk.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	expect(candidates.length).toBe(1);
	expect(candidates[0]?.collidesWith.some((collision) => collision.path === 'src/loadRowsFromDisk.ts')).toBeTruthy();
});

test.each([{ existing: 'src/remove-stale-entry.ts' }, { existing: 'src/remove_stale_entry.ts' }])(
	'detectPriorArtCandidates: $existing collides with a camelCase synonym twin',
	async ({ existing }) => {
		const { cwd, planPaths } = setup({ existing: [existing], creates: ['src/deleteStaleEntry.ts'] });
		const candidates = await detectPriorArtCandidates({ cwd, planPaths });

		expect(candidates.length).toBe(1);
		expect(candidates[0]?.collidesWith.some((collision) => collision.path === existing)).toBeTruthy();
	},
);

test('detectPriorArtCandidates: inside a standards pack a tests/ document set is source, so a check under it is prior art', async () => {
	const existing = ['standards/lightsout-standards.json', 'standards/tests/unit-testing/05-rule/scanRule.ts', 'standards/common/utils/scanRule.unit.test.ts'];
	const { cwd, planPaths } = setup({ existing, creates: ['src/scanRule.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	// the census is built from the pack roots the walk reported: under one,
	// `tests/` names a document set and the checks in it are ordinary source —
	// while the pack's own `.unit.test.ts` says what it is in its filename and
	// stays out
	expect(candidates.length).toBe(1);
	expect(candidates[0]?.collidesWith).toStrictEqual([{ name: 'scanRule', path: 'standards/tests/unit-testing/05-rule/scanRule.ts' }]);
});

test('detectPriorArtCandidates: a file the plan deletes stops contributing its exports to the census', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/legacy/getUser.ts'], creates: ['src/getUser.ts'], deletes: ['src/legacy/getUser.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	// the file is still on disk today, but the plan removes it — colliding with it
	// is colliding with something the plan has already dealt with
	expect(candidates).toStrictEqual([]);
});

test('detectPriorArtCandidates: a file the plan moves stops contributing its exports from the path it moves away from', async () => {
	const { cwd, planPaths } = setup({
		existing: ['cli/common/formatting/formatDuration.ts'],
		creates: ['packages/shared/formatDuration.ts'],
		moves: [{ from: 'cli/common/formatting/formatDuration.ts', to: 'packages/shared/formatDuration.ts' }],
	});
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	// a symbol changing packages collided with itself indefinitely, because the
	// old path stayed in the census however the move was recorded
	expect(candidates).toStrictEqual([]);
});

test('detectPriorArtCandidates: a collision the plan neither deletes nor moves is still a candidate', async () => {
	const { cwd, planPaths } = setup({
		existing: ['src/legacy/getUser.ts', 'src/other/fetchUser.ts'],
		creates: ['src/getUser.ts'],
		deletes: ['src/legacy/getUser.ts'],
	});
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	// subtracting the deleted path never widens into subtracting the rest
	expect(candidates.length).toBe(1);
	expect(candidates[0]?.collidesWith.map((collision) => collision.path)).toStrictEqual(['src/other/fetchUser.ts']);
});

test('detectPriorArtCandidates: a delete in one plan file empties the path for a symbol planned in another', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/legacy/getUser.ts'], creates: ['src/getUser.ts'] });
	const second = join(cwd, '.lightsout', 'plans', 'p', 'phase2-cleanup.md');

	writeFileSync(second, '# Phase 2\n\n## Files to Delete\n\n### `src/legacy/getUser.ts`\n\ngone.\n');

	const candidates = await detectPriorArtCandidates({ cwd, planPaths: [...planPaths, second] });

	// the census is the repo the whole plan leaves behind, not the repo one phase
	// leaves behind
	expect(candidates).toStrictEqual([]);
});
