/**
 * @jest-environment node
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { getReader, type LightsoutReader } from '#src/lightsout/index.ts';

/**
 * Two entries as `.lightsout/friction.jsonl` holds them: one line per record,
 * in the order the runs that reported them appended it.
 */
const frictionRecords = [
	{ kind: 'friction', area: 'plan', detail: 'the plan named no fixture path', at: '2026-01-01T00:00:00.000Z', runId: 'abcdef0123456789', step: 'implement' },
	{
		kind: 'decision',
		area: 'environment',
		detail: 'chose the workspace runner over the global one',
		at: '2026-01-02T00:00:00.000Z',
		runId: 'abcdef0123456789',
		step: 'test',
	},
];

/** The default log, as text — what a test overriding `lines` writes its own version of. */
const frictionLines = frictionRecords.map((record) => JSON.stringify(record));

/**
 * A repo with a friction log, pointed at through `LIGHTSOUT_REPO` — the only
 * seam a test has on the repo root, and the same one the reader's own suite
 * uses.
 */
const setupFrictionReader = async ({ lines = frictionLines }: { lines?: string[] } = {}): Promise<{ reader: LightsoutReader }> => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'lightsout-reader-friction-'));

	await mkdir(join(repoRoot, '.lightsout'), { recursive: true });
	await writeFile(join(repoRoot, '.lightsout', 'friction.jsonl'), `${lines.join('\n')}\n`, 'utf8');

	process.env.LIGHTSOUT_REPO = repoRoot;

	return { reader: getReader() };
};

/**
 * A repo that has run lightsout and had nothing to complain about: its
 * `.lightsout/` is there and the log inside it was never written.
 *
 * A second arrangement rather than an empty `lines` value, because what it
 * arranges is a missing file rather than an empty one — the case the page's
 * empty state exists for.
 */
const setupQuietRepo = async (): Promise<{ reader: LightsoutReader }> => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'lightsout-reader-quiet-'));

	await mkdir(join(repoRoot, '.lightsout'), { recursive: true });

	process.env.LIGHTSOUT_REPO = repoRoot;

	return { reader: getReader() };
};

/** No repo above this directory at all — the public build, which reads nobody's disk. */
const setupPublicBuild = (): { reader: LightsoutReader } => {
	process.env.LIGHTSOUT_PUBLIC = '1';

	return { reader: getReader() };
};

afterEach(() => {
	delete process.env.LIGHTSOUT_REPO;
	delete process.env.LIGHTSOUT_PUBLIC;
});

describe('getReader friction', () => {
	test('reads the friction log of the repo it was pointed at, whole and in the order it was written', async () => {
		const { reader } = await setupFrictionReader();

		const records = await reader.getFriction();

		expect(records).toStrictEqual([
			{
				kind: 'friction',
				area: 'plan',
				detail: 'the plan named no fixture path',
				at: '2026-01-01T00:00:00.000Z',
				runId: 'abcdef0123456789',
				step: 'implement',
			},
			{
				kind: 'decision',
				area: 'environment',
				detail: 'chose the workspace runner over the global one',
				at: '2026-01-02T00:00:00.000Z',
				runId: 'abcdef0123456789',
				step: 'test',
			},
		]);
	});

	test('keeps the entries either side of a line nothing can read, so one bad append never hides the log', async () => {
		const { reader } = await setupFrictionReader({ lines: ['{ not json at all', ...frictionLines, JSON.stringify({ area: 'plan' })] });

		const records = await reader.getFriction();

		expect(records.map((record) => record.detail)).toStrictEqual(['the plan named no fixture path', 'chose the workspace runner over the global one']);
	});

	test('answers with an empty log for a repo that has never recorded any', async () => {
		const { reader } = await setupQuietRepo();

		const records = await reader.getFriction();

		expect(records).toStrictEqual([]);
	});

	test('answers with an empty log where no repo was found, since nothing ever reported friction in a build that reads no disk', async () => {
		const { reader } = setupPublicBuild();

		const records = await reader.getFriction();

		expect(records).toStrictEqual([]);
	});
});
