import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { fingerprintScopeFiles } from '#src/pipeline/steps/refactorStep/common/utils/fingerprintScopeFiles.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const rewrittenPath = 'src/widget.ts';
const deletedPath = 'src/gadget.ts';

const firstBytes = 'export const widget = () => 1;\n';
const secondBytes = 'export const widget = () => 2;\n';

/** Spelled out rather than imported from the engine, so the test states the hash the helper promises. */
const hashOf = ({ content }: { content: string }) => createHash('sha256').update(content).digest('hex');

/**
 * A run whose standards scope holds two files, of which one has since been
 * rewritten and the other deleted — the state a cleanup round leaves behind.
 */
const setupScope = async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-fingerprint-scope-'));

	writeRepoFile({ cwd, path: rewrittenPath, content: firstBytes });
	writeRepoFile({ cwd, path: deletedPath, content: 'export const gadget = () => 1;\n' });

	writeRepoFile({ cwd, path: rewrittenPath, content: secondBytes });
	await rm(join(cwd, deletedPath));

	const run = { cwd, config, current: () => ({ changedFiles: [rewrittenPath, deletedPath] }) } as unknown as PipelineRun;

	return { run };
};

describe('fingerprintScopeFiles', () => {
	test('hashes every readable scope file by content and omits one that is gone', async () => {
		const { run } = await setupScope();

		const fingerprints = await fingerprintScopeFiles({ run });

		// the rewritten file answers the hash of its current bytes, not of the
		// bytes it held before the round, so a round's edit is visible by content;
		// the deleted file is simply absent, because a file that is gone is a
		// later-side answer rather than an error
		expect(fingerprints).toStrictEqual({ [rewrittenPath]: hashOf({ content: secondBytes }) });
		expect(fingerprints[rewrittenPath]).not.toBe(hashOf({ content: firstBytes }));
	});
});
