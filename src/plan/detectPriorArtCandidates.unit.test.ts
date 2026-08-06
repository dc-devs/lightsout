import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { LightsoutConfig } from '@/contracts';
import { detectPriorArtCandidates } from '@/plan';

/** A temp repo with the given existing source files and a plan whose Files-to-Create lists the given paths. */
const setup = ({ existing, creates }: { existing: string[]; creates: string[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-dedup-detect-'));

	for (const rel of existing) {
		const abs = join(cwd, rel);

		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, 'export const x = 1;\n');
	}

	const plansDir = join(cwd, '.claude', 'plans');

	mkdirSync(plansDir, { recursive: true });

	const body = `# Plan\n\n## Files to Create\n\n${creates.map((path) => `### \`${path}\`\n\nnew.\n`).join('\n')}\n`;
	const planPath = join(plansDir, 'p.md');

	writeFileSync(planPath, body);

	return { cwd, planPaths: [planPath] };
};

test('detectPriorArtCandidates: a synonym name-collision is a candidate', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	expect(candidates.length).toBe(1);
	expect(candidates[0]?.plannedSymbol).toBe('getUser');
	expect(candidates[0]?.plannedPath).toBe('src/getUser.ts');
	expect(candidates[0]?.collidesWith.some((collision) => collision.name === 'fetchUser')).toBeTruthy();
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
	const ghost = join(cwd, '.claude', 'plans', 'ghost.md');

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
		scripts: { check: 'true', testUnit: 'true', testCoverage: false },
		generated: ['generated-src/'],
	});

	const candidates = await detectPriorArtCandidates({ cwd, planPaths, config });

	// generated output is not prior art
	expect(candidates).toStrictEqual([]);
});
