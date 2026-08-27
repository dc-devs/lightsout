/**
 * @jest-environment node
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from '@jest/globals';

// The command that turns the committed dataset into the two README GIFs, run as
// the real subprocess `pnpm build:sprawl-gif` runs.
//
// Each case works in a throwaway copy of the repo's shape. The renderer takes
// no output path — it anchors on its own file's location — so running it in
// place would overwrite the committed images, and a test that repaired what it
// was measuring would be worth nothing. `scripts/` is COPIED for that reason: a
// symlink resolves back to the real directory, and the renderer would write
// into the real `assets/` again.
//
// This sits in tests/ rather than beside a source file because its subject is
// outside src/ and names nothing next to it.

const repoRoot = join(__dirname, '..', '..', '..', '..');
const workspaces: string[] = [];

interface DeltaParams {
	files?: { path: string; lines: number }[];
	folders?: { path: string; entries: number }[];
	removedFiles?: string[];
	overCap?: number;
}

/** One lane at one frame. Both removal arrays are declared even when empty, which is what the dataset's own schema demands. */
const buildDelta = ({ files = [], folders = [], removedFiles = [], overCap = 0 }: DeltaParams) => ({
	files,
	folders,
	removedFiles,
	removedFolders: [],
	overCap,
});

/**
 * Two commits: one file grown past the cap, then the split that answers it.
 *
 * Small on purpose. The renderer holds the final frame for two seconds and
 * every marker for a quarter of one, so the encode is dominated by repeats the
 * schedule already covers — more history here would buy no branch and cost
 * whole minutes of rasterising.
 */
const buildDataset = () => ({
	headSha: 'b2b2b2b',
	caps: { file: 250, tsxFile: 300, function: 80, testFile: 400, folderCensus: 2 },
	droppedCommits: 0,
	frames: [
		{
			sha: 'a1a1a1a',
			at: '2026-01-01T00:00:00Z',
			subject: 'grow one file past the cap',
			isRefactorMarker: false,
			with: buildDelta({ files: [{ path: 'src/big.ts', lines: 400 }], folders: [{ path: 'src', entries: 3 }], overCap: 1 }),
			without: buildDelta({ files: [{ path: 'src/big.ts', lines: 400 }], folders: [{ path: 'src', entries: 3 }], overCap: 1 }),
		},
		{
			sha: 'b2b2b2b',
			at: '2026-01-02T00:00:00Z',
			subject: 'graduate it into a folder',
			isRefactorMarker: true,
			with: buildDelta({ files: [{ path: 'src/big/index.ts', lines: 120 }], folders: [{ path: 'src/big', entries: 2 }], removedFiles: ['src/big.ts'] }),
			without: buildDelta({ files: [{ path: 'src/big.ts', lines: 420 }], overCap: 1 }),
		},
	],
});

/**
 * A repo-shaped directory the renderer can run in: its own copy of `scripts/`,
 * its own `assets/`, and links to the two trees it only reads — the package
 * source it imports the layout from, and the installed dependencies that
 * rasterise and encode.
 */
const setupWorkspace = ({ withDataset = true }: { withDataset?: boolean } = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-sprawl-gif-'));

	workspaces.push(dir);
	cpSync(join(repoRoot, 'scripts'), join(dir, 'scripts'), { recursive: true });
	symlinkSync(join(repoRoot, 'node_modules'), join(dir, 'node_modules'), 'dir');
	symlinkSync(join(repoRoot, 'packages'), join(dir, 'packages'), 'dir');
	mkdirSync(join(dir, 'assets'));

	if (withDataset) {
		writeFileSync(join(dir, 'assets', 'sprawl-dataset.json'), JSON.stringify(buildDataset()));
	}

	return { dir };
};

/** The renderer's whole verdict: its exit code, everything it printed, and the first bytes of each file it left behind. */
const renderGifs = ({ dir }: { dir: string }) => {
	const result = spawnSync('node', [join(dir, 'scripts', 'renderSprawlGif.mjs')], { cwd: dir, encoding: 'utf8' });
	const header = ({ file }: { file: string }) => {
		const path = join(dir, 'assets', file);

		return existsSync(path) ? readFileSync(path).subarray(0, 6).toString('latin1') : 'missing';
	};

	return {
		status: result.status,
		output: `${result.stdout}${result.stderr}`,
		dark: header({ file: 'sprawl.gif' }),
		light: header({ file: 'sprawl-light.gif' }),
	};
};

afterAll(() => {
	for (const dir of workspaces) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('renderSprawlGif', () => {
	test('writes both README renders from one dataset, at the size the README declares', () => {
		const { dir } = setupWorkspace();

		const { status, output, dark, light } = renderGifs({ dir });

		expect({ status, dark, light, written: output.match(/^sprawl.*$/gm) }).toEqual({
			status: 0,
			dark: 'GIF89a',
			light: 'GIF89a',
			written: [expect.stringMatching(/^sprawl\.gif: 1200 × 630, \d+\.\d\d MB$/), expect.stringMatching(/^sprawl-light\.gif: 1200 × 630, \d+\.\d\d MB$/)],
		});
	}, 120_000);

	test('says what it sampled and how much it will encode, so a dropped commit is never silent', () => {
		const { dir } = setupWorkspace();

		const { output } = renderGifs({ dir });

		// Two frames, of which the marker is held three ticks, plus the two
		// seconds the last frame is held on at twelve a second.
		expect(output.split('\n').slice(0, 2)).toStrictEqual(['sampled 2 of 2 frames, 1 of them refactor markers', 'encoding 28 frames at 12 fps']);
	}, 120_000);

	test('reports a missing dataset and sets an exit code, rather than writing half a pair', () => {
		const { dir } = setupWorkspace({ withDataset: false });

		const { status, output, dark, light } = renderGifs({ dir });

		expect({ status, dark, light }).toStrictEqual({ status: 1, dark: 'missing', light: 'missing' });
		expect(output).toContain('sprawl-dataset.json');
	});
});
