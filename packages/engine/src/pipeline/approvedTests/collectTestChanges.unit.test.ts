import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { ApprovedTestRecord, LightsoutConfig, RunManifest } from '#src/contracts/index.ts';
import { approvedTestPath } from '#src/pipeline/approvedTests/approvedTestPath.ts';
import { collectTestChanges } from '#src/pipeline/approvedTests/collectTestChanges.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// The checkpoint's change bundle: which paths are candidates, which of them
// differ from their approved version, and under which kind each difference is
// reported. The repo is real and so is its git history, because the approved
// version of a path the run holds no copy of IS its content at HEAD.

const runId = 'run-1';

interface Fixture {
	/** Repo-relative files committed at HEAD — the approved version of any path the run recorded no copy of. */
	committed?: Record<string, string>;
	/** Repo-relative files as they stand on disk now; `null` deletes the committed file. */
	live?: Record<string, string | null>;
	/** Approved copies the run already recorded: a string writes the copy, `null` records an approved removal. */
	approved?: Record<string, string | null>;
	/** The manifest's changed-file list, one of the three routes a path becomes a candidate. */
	changedFiles?: string[];
	/** Extra config fields, for the generated and vendored prefixes. */
	config?: Partial<LightsoutConfig>;
}

/** A PipelineRun stub over a real git repo, with the approved copies already on disk. */
const setupChangeRun = ({ committed = {}, live = {}, approved = {}, changedFiles = [], config = {} }: Fixture = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-test-changes-'));

	for (const [path, content] of Object.entries(committed)) {
		writeRepoFile({ cwd, path, content });
	}

	execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init --allow-empty', { cwd });

	for (const [path, content] of Object.entries(live)) {
		if (content === null) {
			rmSync(join(cwd, path));
		} else {
			writeRepoFile({ cwd, path, content });
		}
	}

	const approvedTests: ApprovedTestRecord[] = Object.entries(approved).map(([path, content]) => {
		if (content === null) {
			return { path, removed: true };
		}

		const copy = approvedTestPath({ cwd, runId, path });

		mkdirSync(dirname(copy), { recursive: true });
		writeFileSync(copy, content);

		return { path, sha256: sha256({ content }), removed: false };
	});

	const run = {
		cwd,
		config: config as LightsoutConfig,
		current: () => ({ runId, changedFiles, approvedTests }) as unknown as RunManifest,
	};

	return { run: run as unknown as PipelineRun, cwd };
};

test('collectTestChanges: a test-side file matching its approved version is not bundled', async () => {
	const { run } = setupChangeRun({
		committed: {
			'src/untouched.unit.test.ts': "test('untouched: one', () => {});\n",
			'src/approved.unit.test.ts': "test('approved: one', () => {});\n",
		},
		// the second file no longer matches HEAD, but it matches the copy the run
		// approved — which is the version the bundle is measured against
		live: { 'src/approved.unit.test.ts': "test('approved: two', () => {});\n" },
		approved: { 'src/approved.unit.test.ts': "test('approved: two', () => {});\n" },
		changedFiles: ['src/untouched.unit.test.ts', 'src/approved.unit.test.ts'],
	});

	const changes = await collectTestChanges({ run });

	// an empty bundle is what invokes no reviewer at all
	expect(changes).toStrictEqual([]);
});

test('collectTestChanges: added, modified and removed files are bundled under their kinds, each carrying a diff', async () => {
	const { run } = setupChangeRun({
		committed: {
			'src/modified.unit.test.ts': "test('modified case, first', () => {});\n",
			'src/removed.unit.test.ts': "test('removed case', () => {});\n",
		},
		live: {
			'src/added.unit.test.ts': "test('added case', () => {});\n",
			'src/modified.unit.test.ts': "test('modified case, second', () => {});\n",
			'src/removed.unit.test.ts': null,
		},
		changedFiles: ['src/added.unit.test.ts', 'src/modified.unit.test.ts', 'src/removed.unit.test.ts'],
	});

	const changes = await collectTestChanges({ run });

	// sorted by path, so a re-entry hands the reviewer the same bundle it saw
	// first, and each entry carries the text the reviewer judges
	expect(changes).toEqual([
		{ path: 'src/added.unit.test.ts', kind: 'added', diff: expect.stringContaining("+test('added case'") },
		{ path: 'src/modified.unit.test.ts', kind: 'modified', diff: expect.stringContaining("-test('modified case, first'") },
		{ path: 'src/removed.unit.test.ts', kind: 'removed', diff: expect.stringContaining("-test('removed case'") },
	]);
	expect(changes[1]?.diff).toContain("+test('modified case, second'");
});

test('collectTestChanges: a changed source file is never bundled, however the run changed it', async () => {
	const { run } = setupChangeRun({
		committed: {
			'src/widget.ts': 'export const widget = 1;\n',
			'src/widget.unit.test.ts': "test('widget: one', () => {});\n",
		},
		live: {
			'src/widget.ts': 'export const widget = 2;\n',
			'src/widget.unit.test.ts': "test('widget: two', () => {});\n",
		},
		// the source file arrives by both routes at once — git saw it change and
		// the manifest names it — and neither route gets it into the bundle
		changedFiles: ['src/widget.ts', 'src/widget.unit.test.ts'],
	});

	const changes = await collectTestChanges({ run });

	// the test file beside it proves the collection ran rather than found nothing
	expect(changes.map(({ path }) => path)).toStrictEqual(['src/widget.unit.test.ts']);
});

test('collectTestChanges: a path under a generated or vendored prefix is never bundled', async () => {
	const { run } = setupChangeRun({
		config: { generated: ['plugin/dist/'], vendored: ['vendor/'] },
		committed: {
			'plugin/dist/tests/rule.unit.test.ts': "test('generated rule: one', () => {});\n",
			'vendor/ui/__tests__/button.unit.test.ts': "test('vendored button: one', () => {});\n",
			'src/widget.unit.test.ts': "test('widget: one', () => {});\n",
		},
		live: {
			'plugin/dist/tests/rule.unit.test.ts': "test('generated rule: two', () => {});\n",
			'vendor/ui/__tests__/button.unit.test.ts': "test('vendored button: two', () => {});\n",
			'src/widget.unit.test.ts': "test('widget: two', () => {});\n",
		},
		changedFiles: ['plugin/dist/tests/rule.unit.test.ts', 'vendor/ui/__tests__/button.unit.test.ts', 'src/widget.unit.test.ts'],
	});

	const changes = await collectTestChanges({ run });

	// a gate rewrote both, so neither is an agent's edit to a test — even though
	// one sits under a `tests/` directory and both are named like test code
	expect(changes.map(({ path }) => path)).toStrictEqual(['src/widget.unit.test.ts']);
});
