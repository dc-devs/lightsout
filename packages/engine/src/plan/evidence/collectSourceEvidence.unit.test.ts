import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type ExploreArea, type PlanFacts, type SourceEvidenceEntry, SourceEvidenceIndex } from '#src/contracts/index.ts';
import { collectSourceEvidence } from '#src/plan/evidence/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

const planName = 'focused-drafting';

/** One explorer area with only the recorded locations a case needs; every other field is the empty answer. */
const exploreArea = ({
	filesToModify = [],
	patternsToMirror = [],
	integrationPoints = [],
}: Partial<Pick<ExploreArea, 'filesToModify' | 'patternsToMirror' | 'integrationPoints'>> = {}): ExploreArea => ({
	area: 'the drafting evidence',
	affectedPackages: [],
	filesToModify,
	patternsToMirror,
	integrationPoints,
	scripts: [],
	namingConvention: 'camelCase',
});

/**
 * A source file far above the 12,000-byte whole-file limit, holding one
 * documented export and padding helpers nothing references — so a reduced entry
 * is visibly smaller than the file it came from.
 */
const oversizedSource = [
	"import { join } from 'node:path';",
	...Array.from(
		{ length: 300 },
		(_, index) =>
			`/** Padding ${index} — nothing references this helper. */\nconst padding${index} = (): string => join('padding', '${index}', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');`,
	),
	"/** The one export a plan writer needs from this file. */\nexport const keptExport = (): string => 'kept';",
].join('\n\n');

const smallSource = 'export const small = (): number => 1;\n';

interface SetupParams {
	/** Repo-relative path → contents, written into the temp repo before the call. */
	files?: Record<string, string>;
	areas?: ExploreArea[];
	/** Raw text seeded as `source-evidence.json` before the call — a prior run's record, readable or not. */
	existingRecord?: string;
	/** false → the temp repo has no resolvable TypeScript, so no extraction can run. */
	withTypescript?: boolean;
}

/** A temp repo holding the given source files, an empty plan workspace, and the verified facts naming them. */
const setupEvidenceRepo = ({ files = {}, areas = [], existingRecord, withTypescript = true }: SetupParams = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-evidence-'));

	if (withTypescript) {
		linkTypescript({ dir: cwd });
	}

	for (const [path, content] of Object.entries(files)) {
		writeRepoFile({ cwd, path, content });
	}

	const recordPath = join(cwd, '.lightsout', 'plans', planName, 'source-evidence.json');

	mkdirSync(dirname(recordPath), { recursive: true });

	if (existingRecord !== undefined) {
		writeFileSync(recordPath, existingRecord);
	}

	const facts: PlanFacts = {
		request: 'collect the evidence once',
		areas,
		verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [] },
		verifiedAt: '2026-01-01T00:00:00.000Z',
	};

	return { cwd, facts, recordPath };
};

/** The one entry for a path, with the presence check kept ahead of every dereference. */
const entryFor = ({ index, path }: { index: SourceEvidenceIndex; path: string }): SourceEvidenceEntry => {
	const entry = index.entries.find((candidate) => candidate.path === path);

	expectDefined(entry);

	return entry;
};

/** A prior run's record holding one entry, serialised the way the collector would have written it. */
const storedRecord = ({ entry }: { entry: SourceEvidenceEntry }): string =>
	JSON.stringify({ planName, entries: [entry], collectedAt: '2026-01-01T00:00:00.000Z' });

describe('collectSourceEvidence', () => {
	test('collectSourceEvidence: a path the facts name twice yields one entry carrying both roles', async () => {
		const { cwd, facts } = setupEvidenceRepo({
			files: { 'src/target.ts': smallSource },
			areas: [
				exploreArea({
					filesToModify: [{ path: 'src/target.ts', role: 'the file the change edits' }],
					integrationPoints: [{ name: 'small', signature: 'small(): number', at: 'src/target.ts:1' }],
				}),
			],
		});

		const index = await collectSourceEvidence({ cwd, name: planName, facts });

		expect(index.entries.filter(({ path }) => path === 'src/target.ts').length).toBe(1);

		const entry = entryFor({ index, path: 'src/target.ts' });

		expect(entry.roles.length).toBe(2);
		expect(entry.roles).toEqual(expect.arrayContaining(['the file the change edits', expect.stringContaining('small(): number')]));
	});

	test('collectSourceEvidence: a pattern to mirror is collected with the takeaway the facts recorded for it', async () => {
		const { cwd, facts } = setupEvidenceRepo({
			files: { 'src/mirrorMe.ts': smallSource },
			areas: [exploreArea({ patternsToMirror: [{ path: 'src/mirrorMe.ts', takeaway: 'the shape the new helper copies' }] })],
		});

		const index = await collectSourceEvidence({ cwd, name: planName, facts });

		const entry = entryFor({ index, path: 'src/mirrorMe.ts' });

		// a pattern the explorer recorded is evidence in its own right, and the
		// takeaway is the only statement of what to take from it — a file collected
		// with no reason attached is source a writer has to re-derive the point of
		expect(entry).toEqual(expect.objectContaining({ kind: 'whole', text: smallSource, roles: ['the shape the new helper copies'] }));
	});

	test('collectSourceEvidence: an integration point with no line suffix names the whole path', async () => {
		const { cwd, facts } = setupEvidenceRepo({
			files: { 'src/bare.ts': smallSource },
			areas: [exploreArea({ integrationPoints: [{ name: 'small', signature: 'small(): number', at: 'src/bare.ts' }] })],
		});

		const index = await collectSourceEvidence({ cwd, name: planName, facts });

		// only a trailing :line or :line:column is stripped — trimming anything else
		// would turn a plain path into a path nothing is on disk at, and the entry
		// would report the file missing rather than carry it
		expect(index.entries.map(({ path, kind }) => ({ path, kind }))).toStrictEqual([{ path: 'src/bare.ts', kind: 'whole' }]);
	});

	test('collectSourceEvidence: a small file is stored whole and only an oversized one is reduced to definitions', async () => {
		const { cwd, facts } = setupEvidenceRepo({
			files: { 'src/small.ts': smallSource, 'src/oversized.ts': oversizedSource },
			areas: [
				exploreArea({
					filesToModify: [
						{ path: 'src/small.ts', role: 'an ordinary source file' },
						{ path: 'src/oversized.ts', role: 'a file well past the limit' },
					],
				}),
			],
		});

		const index = await collectSourceEvidence({ cwd, name: planName, facts });

		const small = entryFor({ index, path: 'src/small.ts' });
		const oversized = entryFor({ index, path: 'src/oversized.ts' });

		expect(small).toEqual(expect.objectContaining({ kind: 'whole', text: smallSource }));
		expect(oversized.kind).toBe('definitions');
		expect(oversized.definitions).toContain('keptExport');
		expect(oversized.text).toContain('export const keptExport');
		// the padding the reduction dropped is what makes this smaller than the file
		expect(oversized.text).not.toContain('padding299');
	});

	test('collectSourceEvidence: an entry whose source hash changed is re-collected from the current contents', async () => {
		const current = 'export const current = (): number => 2;\n';
		const stale = 'export const stale = (): number => 1;\n';
		const { cwd, facts } = setupEvidenceRepo({
			files: { 'src/target.ts': current },
			areas: [exploreArea({ filesToModify: [{ path: 'src/target.ts', role: 'the file the change edits' }] })],
			existingRecord: storedRecord({
				entry: {
					path: 'src/target.ts',
					sha256: sha256({ content: stale }),
					kind: 'whole',
					bytes: Buffer.byteLength(stale),
					text: stale,
					roles: ['the file the change edits'],
					definitions: [],
				},
			}),
		});

		const index = await collectSourceEvidence({ cwd, name: planName, facts });

		const entry = entryFor({ index, path: 'src/target.ts' });

		expect(entry.text).toBe(current);
		expect(entry.sha256).toBe(sha256({ content: current }));
	});

	test('collectSourceEvidence: an unchanged file keeps its stored text while its roles are refreshed', async () => {
		const source = 'export const unchanged = (): number => 3;\n';
		// deliberately not the file's own text: only a carried-through entry can still hold it
		const carried = 'EVIDENCE THE EARLIER RUN STORED';
		const { cwd, facts } = setupEvidenceRepo({
			files: { 'src/target.ts': source },
			areas: [exploreArea({ filesToModify: [{ path: 'src/target.ts', role: 'the role this run records' }] })],
			existingRecord: storedRecord({
				entry: {
					path: 'src/target.ts',
					sha256: sha256({ content: source }),
					kind: 'whole',
					bytes: Buffer.byteLength(source),
					text: carried,
					roles: ['the role the earlier run recorded'],
					definitions: [],
				},
			}),
		});

		const index = await collectSourceEvidence({ cwd, name: planName, facts });

		const entry = entryFor({ index, path: 'src/target.ts' });

		expect(entry.text).toBe(carried);
		expect(entry.roles).toStrictEqual(['the role this run records']);
	});

	test('collectSourceEvidence: a facts path with nothing on disk becomes a missing entry rather than a failure', async () => {
		const { cwd, facts } = setupEvidenceRepo({
			files: { 'src/present.ts': smallSource },
			areas: [
				exploreArea({
					filesToModify: [{ path: 'src/present.ts', role: 'the file the change edits' }],
					integrationPoints: [{ name: 'gone', signature: 'gone(): void', at: 'src/gone.ts:7' }],
				}),
			],
		});

		const index = await collectSourceEvidence({ cwd, name: planName, facts });

		const missing = entryFor({ index, path: 'src/gone.ts' });

		expect(missing).toEqual(expect.objectContaining({ kind: 'missing', text: '', bytes: 0, sha256: '' }));
		expect(entryFor({ index, path: 'src/present.ts' }).text).toBe(smallSource);
	});

	test('collectSourceEvidence: with no consumer compiler an oversized file is stored whole rather than guessed at', async () => {
		const { cwd, facts } = setupEvidenceRepo({
			withTypescript: false,
			files: { 'src/oversized.ts': oversizedSource },
			areas: [exploreArea({ filesToModify: [{ path: 'src/oversized.ts', role: 'a file well past the limit' }] })],
		});

		const index = await collectSourceEvidence({ cwd, name: planName, facts });

		const entry = entryFor({ index, path: 'src/oversized.ts' });

		expect(entry.kind).toBe('whole');
		expect(entry.text).toBe(oversizedSource);
	});

	test('collectSourceEvidence: an unreadable existing record is discarded and every entry re-collected', async () => {
		const { cwd, facts, recordPath } = setupEvidenceRepo({
			files: { 'src/target.ts': smallSource },
			areas: [exploreArea({ filesToModify: [{ path: 'src/target.ts', role: 'the file the change edits' }] })],
			existingRecord: 'this record is not JSON at all {{{',
		});

		const index = await collectSourceEvidence({ cwd, name: planName, facts });

		expect(entryFor({ index, path: 'src/target.ts' }).text).toBe(smallSource);

		const rewritten: unknown = JSON.parse(readFileSync(recordPath, 'utf8'));

		expect(SourceEvidenceIndex.parse(rewritten).entries.map(({ path }) => path)).toStrictEqual(['src/target.ts']);
	});
});
