import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { ApprovedTestRecord } from '#src/contracts/index.ts';
import { approveTestFiles } from '#src/pipeline/approvedTests/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

const runId = 'run-1';
const testPath = 'src/widget.unit.test.ts';
const otherPath = 'src/gadget.unit.test.ts';

const hashOf = ({ content }: { content: string }) => createHash('sha256').update(content).digest('hex');

/** Where the run keeps the approved copy of one test-side file. Spelled out rather than imported, so the test states the path the run promises. */
const approvedCopy = ({ cwd, path }: { cwd: string; path: string }) => join(cwd, '.lightsout', 'runs', runId, 'approved', path);

interface SetupParams {
	/** Repo-relative path to content, written into the working tree. */
	files?: Record<string, string>;
	/** Repo-relative path to content, written into the run's approved directory as an already-taken copy. */
	copies?: Record<string, string>;
	/** What the manifest already records. */
	approvedTests?: ApprovedTestRecord[];
}

const setupRun = ({ files = {}, copies = {}, approvedTests = [] }: SetupParams = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-approve-tests-'));

	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(cwd, path)), { recursive: true });
		writeFileSync(join(cwd, path), content);
	}

	for (const [path, content] of Object.entries(copies)) {
		const copy = approvedCopy({ cwd, path });

		mkdirSync(dirname(copy), { recursive: true });
		writeFileSync(copy, content);
	}

	const run = { cwd, current: () => ({ runId, approvedTests }) } as unknown as PipelineRun;

	return { cwd, run };
};

test('approveTestFiles: an existing file is copied into the run folder and recorded with its hash', async () => {
	const source = "test('widget: renders', () => { expect(render()).toBe('widget'); });\n";
	const { cwd, run } = setupRun({ files: { [testPath]: source } });

	const records = await approveTestFiles({ run, paths: [testPath] });

	// the copy plus its hash is what a later checkpoint diffs a live file against
	expect(readFileSync(approvedCopy({ cwd, path: testPath }), 'utf8')).toBe(source);
	expect(records).toStrictEqual([{ path: testPath, sha256: hashOf({ content: source }), removed: false }]);
});

test('approveTestFiles: a path that is gone is recorded as an approved removal and its copy is deleted', async () => {
	const { cwd, run } = setupRun({ copies: { [testPath]: "test('widget: renders', () => {});\n" } });

	const records = await approveTestFiles({ run, paths: [testPath] });

	// the approved state of the path is "not in the tree", so a stale copy left
	// behind would make the next checkpoint bundle the deletion all over again
	expect(existsSync(approvedCopy({ cwd, path: testPath }))).toBe(false);
	expect(records).toStrictEqual([{ path: testPath, removed: true }]);
});

test('approveTestFiles: re-approving a path replaces its record instead of duplicating it', async () => {
	const approved = "test('widget: renders', () => { expect(render()).toBe('widget'); });\n";
	const stale: ApprovedTestRecord = { path: testPath, sha256: hashOf({ content: 'older bytes\n' }), removed: false };
	const untouched: ApprovedTestRecord = { path: otherPath, sha256: hashOf({ content: 'gadget bytes\n' }), removed: false };
	const { run } = setupRun({ files: { [testPath]: approved }, approvedTests: [untouched, stale] });

	const records = await approveTestFiles({ run, paths: [testPath] });

	// one path, one record: two records for the same path would leave the
	// baseline asking which of them the live file has to match
	expect(records).toStrictEqual([untouched, { path: testPath, sha256: hashOf({ content: approved }), removed: false }]);
});
