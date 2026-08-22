import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import { writeStandardsSnapshot } from '#src/standardsCheck/index.ts';
import { getStandardsView } from '#src/views/index.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

/** Write a set of pack-relative files, creating the folders they need. */
const writeTree = async ({ dir, files }: { dir: string; files: Record<string, string> }) => {
	for (const [rel, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, rel)), { recursive: true });
		await writeFile(join(dir, rel), content, 'utf8');
	}
};

/** A standards pack of somebody's own: one checked rule and one judgment-only rule. */
const writeStandardsPack = async () => {
	const packPath = await mkdtemp(join(tmpdir(), 'lightsout-view-standards-'));

	await writeTree({
		dir: packPath,
		files: {
			'lightsout-standards.json': '{ "name": "acme", "formatVersion": 1 }\n',
			'code/house/document.md': '# House Style\n\nWhat this shop agrees on.\n',
			'code/house/05-house-loose-file/rule.md':
				'---\nsummary: a source file outside a module\nchecked: true\nseverity: blocking\n---\n\nEvery file belongs to a module.\n',
			'code/house/05-house-loose-file/check.ts':
				"export const check = {\n\tinputKind: 'file-list',\n\trun: ({ input }) => input.files.map((path) => ({ siteKey: `house-loose-file:${path}`, files: [{ path }], detail: 'loose' })),\n};\n",
			'code/house/05-house-loose-file/fixtures/pass/src/mod/index.ts': 'export const mod = 1;\n',
			'code/house/05-house-loose-file/fixtures/fail/src/loose.ts': 'export const loose = 1;\n',
			'code/house/10-house-name-things-well/rule.md':
				'---\nsummary: a name that hides what it does\nchecked: false\nseverity: advisory\n---\n\nNames are the cheapest documentation.\n',
		},
	});

	return packPath;
};

/** A repo on that pack, optionally overriding one rule's state in its own config. */
const seedStandardsRepo = async ({ overrides, packs }: { overrides?: Record<string, unknown>; packs?: string[] | false } = {}) => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-view-repo-'));

	await writeTree({
		dir: cwd,
		files: {
			'src/loose.ts': 'export const loose = 1;\n',
			'lightsout.config.json': JSON.stringify({
				gates: { check: 'true', test: 'true', 'test-coverage': false },
				'standards-packs': packs ?? [await writeStandardsPack()],
				...(overrides ? { 'standards-checks': overrides } : {}),
			}),
		},
	});

	return cwd;
};

const finding = (overrides: Partial<StandardsFinding> = {}): StandardsFinding => ({
	rule: 'house-loose-file',
	severity: StandardsSeverity.Blocking,
	siteKey: 'house-loose-file:src/loose.ts',
	files: [{ path: 'src/loose.ts' }],
	detail: 'loose',
	...overrides,
});

test('a repo that has never run a check still describes what it enforces', async () => {
	const cwd = await seedStandardsRepo();
	const view = await getStandardsView({ cwd });

	// the view answers "what does this repo enforce?", not only "what is broken today"
	expect(view.at).toBe(undefined);
	expect(view.path).toBe('.');
	expect(view.findings).toStrictEqual([]);
	expect(view.notes).toStrictEqual([]);
	expect(view.trend).toStrictEqual([]);
	expect(view.rules.map((rule) => rule.rule)).toStrictEqual(['house-loose-file', 'house-name-things-well']);
	// a judgment-only rule is listed beside the machine-checked one
	expect(view.totals).toStrictEqual({ rules: 2, checked: 1, judgment: 1, blocking: 0, advisory: 0, orphans: 0 });
});

test('a repo with no config at all is described by the standards that ship with the engine', async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-view-bare-'));
	const view = await getStandardsView({ cwd });

	// the bundled pack travels with the engine, so a repo that has configured
	// nothing still gets an honest account of what it is held to
	expect(view.totals.rules > 0).toBe(true);
	expect(view.rules.every((rule) => rule.doc.startsWith('lightsout-defaults: '))).toBe(true);
	expect(view.at).toBe(undefined);
});

test('a rule row carries what the rule says, how this repo runs it, and how many findings it has open', async () => {
	const cwd = await seedStandardsRepo();

	await writeStandardsSnapshot({
		cwd,
		snapshot: {
			at: '2026-08-19T12:00:00.000Z',
			path: 'src',
			findings: [
				finding(),
				finding({ siteKey: 'house-loose-file:src/other.ts' }),
				finding({ rule: 'house-name-things-well', severity: StandardsSeverity.Advisory, siteKey: 'name:src/loose.ts' }),
			],
			notes: ['2 source file(s) scanned'],
		},
	});

	const view = await getStandardsView({ cwd });
	const [checked, judgment] = view.rules;

	expect(view.at).toBe('2026-08-19T12:00:00.000Z');
	// a scoped snapshot says what it covered, so nobody reads it as the whole repo
	expect(view.path).toBe('src');
	expect(view.notes).toStrictEqual(['2 source file(s) scanned']);
	expect(checked).toStrictEqual({
		rule: 'house-loose-file',
		doc: 'acme: code/house',
		documentPath: 'code/house',
		set: 'code',
		summary: 'a source file outside a module',
		prose: 'Every file belongs to a module.',
		checked: true,
		severity: StandardsSeverity.Blocking,
		fromConfig: false,
		settings: {},
		findingCount: 2,
		// no refactor run has met this rule yet
		history: { attempted: 0, resolved: 0, declined: 0, untracked: 0, adviceApplied: 0, adviceDeclined: 0, adviceAlreadyMet: 0, reasons: [] },
	});
	expect(judgment?.findingCount).toBe(1);
	expect(judgment?.checked).toBe(false);
	// the header's counts come from here, so no consumer ever tallies findings itself
	expect(view.totals).toStrictEqual({ rules: 2, checked: 1, judgment: 1, blocking: 2, advisory: 1, orphans: 0 });
});

test('a finding whose rule no pack loads is counted as an orphan, and lands on no rule row', async () => {
	const cwd = await seedStandardsRepo();

	await writeStandardsSnapshot({
		cwd,
		snapshot: {
			at: '2026-08-19T12:00:00.000Z',
			path: '.',
			findings: [finding(), finding({ rule: 'rule-since-removed', siteKey: 'gone:src/loose.ts' })],
			notes: [],
		},
	});

	const view = await getStandardsView({ cwd });

	// a pack removed or renamed since the scan leaves findings nothing explains
	expect(view.totals.orphans).toBe(1);
	expect(view.rules.map((rule) => rule.findingCount)).toStrictEqual([1, 0]);
	// the finding is still reported — hiding it would be a number the reader cannot reconcile
	expect(view.findings.length).toBe(2);
});

test('a rule the config overrode says so, and carries the settings this repo runs it at', async () => {
	const cwd = await seedStandardsRepo({ overrides: { 'house-loose-file': { severity: 'off', settings: { 'max-lines': 400 } } } });
	const view = await getStandardsView({ cwd });

	expect(view.rules[0]?.severity).toBe(StandardsSeverity.Off);
	expect(view.rules[0]?.fromConfig).toBe(true);
	expect(view.rules[0]?.settings).toStrictEqual({ 'max-lines': 400 });
	// the untouched rule keeps its own declaration — silence is never a change
	expect(view.rules[1]?.fromConfig).toBe(false);
});

test('refactor history is folded onto the rule whose sites a run attempted', async () => {
	const cwd = await seedStandardsRepo();
	const worklist = JSON.stringify({
		at: '2026-01-01T00:00:00.000Z',
		path: '.',
		all: false,
		batches: [{ id: 'batch-00:house-loose-file:src', rule: 'house-loose-file', folder: 'src', blocking: [finding()], advisories: [] }],
	});

	await seedRunDir({
		cwd,
		manifest: {
			runId: 'run-refactor',
			pipeline: 'refactor',
			plan: '.lightsout/runs/run-refactor/worklist.json',
			steps: [{ id: 'batch-00:house-loose-file:src', status: 'passed', attempts: 1, report: { outcome: 'resolved', remainingSiteKeys: [], rationale: [] } }],
		},
		worklist,
	});

	const view = await getStandardsView({ cwd });

	// the site was frozen and is gone afterwards, so it counts as resolved
	expect(view.rules[0]?.history).toStrictEqual({
		attempted: 1,
		resolved: 1,
		declined: 0,
		untracked: 0,
		adviceApplied: 0,
		adviceDeclined: 0,
		adviceAlreadyMet: 0,
		reasons: [],
	});
});

test('the trend comes back oldest first, one point per check the user took', async () => {
	const cwd = await seedStandardsRepo();

	await writeStandardsSnapshot({ cwd, snapshot: { at: '2026-08-19T12:00:00.000Z', path: '.', findings: [finding(), finding({ siteKey: 'b' })], notes: [] } });
	await writeStandardsSnapshot({ cwd, snapshot: { at: '2026-08-20T12:00:00.000Z', path: '.', findings: [finding()], notes: [] } });

	const view = await getStandardsView({ cwd });

	// a chart plots it without re-sorting, and the latest snapshot is the last point
	expect(view.trend.map((point) => ({ at: point.at, total: point.total }))).toStrictEqual([
		{ at: '2026-08-19T12:00:00.000Z', total: 2 },
		{ at: '2026-08-20T12:00:00.000Z', total: 1 },
	]);
	expect(view.at).toBe('2026-08-20T12:00:00.000Z');
});

test('every history count and reason lands in its own column, on the rule it belongs to', async () => {
	const cwd = await seedStandardsRepo();
	const worklist = JSON.stringify({
		at: '2026-01-01T00:00:00.000Z',
		path: '.',
		all: false,
		batches: [
			{
				id: 'batch-00:house-loose-file:src',
				rule: 'house-loose-file',
				folder: 'src',
				blocking: [finding({ siteKey: 'a' }), finding({ siteKey: 'b' }), finding({ siteKey: 'c' }), finding({ siteKey: 'd' })],
				advisories: [],
			},
			{
				id: 'batch-01:house-loose-file:lib',
				rule: 'house-loose-file',
				folder: 'lib',
				blocking: [finding({ siteKey: 'e' }), finding({ siteKey: 'f' })],
				advisories: [],
			},
		],
	});

	await seedRunDir({
		cwd,
		manifest: {
			runId: 'run-refactor',
			pipeline: 'refactor',
			plan: '.lightsout/runs/run-refactor/worklist.json',
			steps: [
				{
					id: 'batch-00:house-loose-file:src',
					status: 'passed',
					attempts: 1,
					report: {
						outcome: 'declined',
						remainingSiteKeys: ['b', 'c', 'd'],
						rationale: ['the generated module is not ours to split'],
						advisoryOutcomes: [
							{ rule: 'house-name-things-well', siteKey: 'name:a', outcome: 'applied' },
							{ rule: 'house-name-things-well', siteKey: 'name:b', outcome: 'declined', reason: 'the name is a term of art here' },
							{ rule: 'house-name-things-well', siteKey: 'name:c', outcome: 'declined', reason: 'renaming it would break the published API' },
						],
					},
				},
				{
					id: 'batch-01:house-loose-file:lib',
					status: 'passed',
					attempts: 1,
					report: { outcome: 'resolved', remainingSiteKeys: ['e', 'f'], rationale: [] },
				},
			],
		},
		worklist,
	});

	const view = await getStandardsView({ cwd });

	// six sites frozen: one gone, three the agent declined and said why, and two
	// a batch that called itself resolved left standing without an account
	expect(view.rules[0]?.history).toStrictEqual({
		attempted: 6,
		resolved: 1,
		declined: 3,
		untracked: 2,
		adviceApplied: 0,
		adviceDeclined: 0,
		adviceAlreadyMet: 0,
		reasons: ['the generated module is not ours to split'],
	});
	// advice is recorded against the rule that gave it, never the rule the batch was working
	expect(view.rules[1]?.history).toStrictEqual({
		attempted: 0,
		resolved: 0,
		declined: 0,
		untracked: 0,
		adviceApplied: 1,
		adviceDeclined: 2,
		adviceAlreadyMet: 0,
		reasons: ['the name is a term of art here', 'renaming it would break the published API'],
	});
});

test('a repo that declares no standards packs still reports the findings its last check left', async () => {
	const cwd = await seedStandardsRepo({ packs: false });

	await writeStandardsSnapshot({
		cwd,
		snapshot: {
			at: '2026-08-19T12:00:00.000Z',
			path: '.',
			findings: [finding(), finding({ rule: 'house-name-things-well', severity: StandardsSeverity.Advisory, siteKey: 'name:src/loose.ts' })],
			notes: [],
		},
	});

	const view = await getStandardsView({ cwd });

	// nothing states the rules any more, so every finding is one nothing explains
	expect(view.rules).toStrictEqual([]);
	expect(view.totals).toStrictEqual({ rules: 0, checked: 0, judgment: 0, blocking: 1, advisory: 1, orphans: 2 });
	expect(view.findings.map((entry) => entry.siteKey)).toStrictEqual(['house-loose-file:src/loose.ts', 'name:src/loose.ts']);
});

test('a declared standards pack that cannot be loaded fails the view rather than describing half a repo', async () => {
	const cwd = await seedStandardsRepo({ packs: ['./standards-that-were-never-installed'] });

	await expect(getStandardsView({ cwd })).rejects.toThrow(/standards pack root file not found/);
});

test('a config naming a rule no pack declares fails the view', async () => {
	const cwd = await seedStandardsRepo({ overrides: { 'house-loose-flie': 'off' } });

	// the typo is caught where the valid ids are known, not silently ignored
	await expect(getStandardsView({ cwd })).rejects.toThrow(/no loaded standards pack declares/);
});
