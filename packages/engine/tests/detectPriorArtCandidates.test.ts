import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { detectPriorArtCandidates } from '../src/plan';

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

	assert.equal(candidates.length, 1);
	assert.equal(candidates[0]?.plannedSymbol, 'getUser');
	assert.equal(candidates[0]?.plannedPath, 'src/getUser.ts');
	assert.ok(candidates[0]?.collidesWith.some((collision) => collision.name === 'fetchUser'));
});

test('detectPriorArtCandidates: an exact name-collision is a candidate', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/parseThing.ts'], creates: ['src/other/parseThing.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	assert.equal(candidates.length, 1);
	assert.ok(candidates[0]?.collidesWith.some((collision) => collision.path === 'src/parseThing.ts'));
});

test('detectPriorArtCandidates: a to/from inverse is not a candidate', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/rgbToHex.ts'], creates: ['src/hexToRgb.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	assert.deepEqual(candidates, []);
});

test('detectPriorArtCandidates: a component+route casing pair is not a candidate', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/GetStarted.tsx'], creates: ['src/get-started.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	assert.deepEqual(candidates, []);
});

test('detectPriorArtCandidates: a genuinely novel name yields no candidate', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/brandNewWidget.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	assert.deepEqual(candidates, []);
});

test('detectPriorArtCandidates: collisions against a test file or index.* are excluded', async () => {
	const { cwd, planPaths } = setup({ existing: ['src/tests/getUser.ts', 'src/index.ts'], creates: ['src/getUser.ts'] });
	const candidates = await detectPriorArtCandidates({ cwd, planPaths });

	assert.deepEqual(candidates, []);
});
