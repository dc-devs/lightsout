import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { LightsoutConfig } from '#src/contracts/index.ts';
import { detectPriorArtCandidates } from '#src/plan/index.ts';

/** A temp repo with the given existing source files and a plan whose Files-to-Create lists the given paths. */
const setup = ({ existing, creates }: { existing: string[]; creates: string[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-dedup-detect-'));

	for (const rel of existing) {
		const abs = join(cwd, rel);

		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, 'export const x = 1;\n');
	}

	const dir = join(cwd, '.lightsout', 'plans', 'p');

	mkdirSync(dir, { recursive: true });

	const body = `# Plan\n\n## Files to Create\n\n${creates.map((path) => `### \`${path}\`\n\nnew.\n`).join('\n')}\n`;
	const planPath = join(dir, 'plan.md');

	writeFileSync(planPath, body);

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
