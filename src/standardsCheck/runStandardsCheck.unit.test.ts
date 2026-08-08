import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { runStandardsCheck } from '@/standardsCheck';

const bigBody = `
	let total = 0;
	for (const record of records) {
		if (record.active && record.amount > 0) {
			total += record.amount * record.multiplier + record.bonus;
		} else if (record.pending) {
			total += record.amount / 2 - record.fee;
		} else {
			total -= record.penalty ?? 0;
		}
	}
	return total * 100;
`;

/** A consumer repo with one planted defect per rule. */
const setupCheckRepo = () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-standards-test-'));

	mkdirSync(join(dir, 'src/a/utils'), { recursive: true });
	mkdirSync(join(dir, 'src/b'), { recursive: true });
	mkdirSync(join(dir, 'node_modules'), { recursive: true });
	// The AST tier borrows the consumer's TypeScript — hand the fixture ours.
	symlinkSync(join(process.cwd(), 'node_modules/typescript'), join(dir, 'node_modules/typescript'), 'dir');

	// tier 2 (+ tier 1): systematically renamed twins
	writeFileSync(join(dir, 'src/a/sumTotals.ts'), `export const sumTotals = ({ records }: { records: any[] }) => {${bigBody}};\n`);
	writeFileSync(join(dir, 'src/b/tallyItems.ts'), `export const tallyItems = ({ items }: { items: any[] }) => {\n${bigBody.replace(/records/g, 'items').replace(/record\b/g, 'item').replace(/record\./g, 'item.')}};\n`);

	// tier 0: synonym pair + same-name pair
	writeFileSync(join(dir, 'src/a/getUserData.ts'), 'export const getUserData = () => 1;\n');
	writeFileSync(join(dir, 'src/b/fetchUserData.ts'), 'export const fetchUserData = () => 2;\n');
	writeFileSync(join(dir, 'src/a/normalizeRecord.ts'), 'export const normalizeRecord = () => 1;\n');
	writeFileSync(join(dir, 'src/b/normalizeRecord.ts'), 'export const normalizeRecord = () => 2;\n');

	// structure: multi-export violation, misnamed file, domain-folder candidates
	writeFileSync(join(dir, 'src/a/config.ts'), 'export const loadConfig = () => 1;\nexport const saveConfig = () => 2;\n');
	writeFileSync(join(dir, 'src/a/helpers.ts'), 'export const buildLabel = () => 1;\n');
	writeFileSync(join(dir, 'src/a/utils/formatDate.ts'), 'export const formatDate = () => 1;\n');
	writeFileSync(join(dir, 'src/a/utils/formatCurrency.ts'), 'export const formatCurrency = () => 1;\n');

	// closed exception: const + derived type share a file — must NOT flag
	writeFileSync(join(dir, 'src/a/Action.ts'), "export const Action = {\n\tAdd: 'add',\n} as const;\nexport type Action = (typeof Action)[keyof typeof Action];\n");

	// V1.1 guards — none of these may produce findings:
	// framework dot-suffix (filename-mismatch), to/from opposites (tier 0),
	// component + kebab route pair (tier 0)
	writeFileSync(join(dir, 'src/b/session-response.model.ts'), 'export interface SessionResponse {\n\tid: string;\n}\n');
	writeFileSync(join(dir, 'src/a/hexToRgb.ts'), 'export const hexToRgb = () => 1;\n');
	writeFileSync(join(dir, 'src/b/rgbToHex.ts'), 'export const rgbToHex = () => 2;\n');
	writeFileSync(join(dir, 'src/a/GetStarted.tsx'), 'export const GetStarted = () => 1;\n');
	writeFileSync(join(dir, 'src/b/get-started.ts'), 'export const getStarted = () => 1;\n');

	// size: oversized .ts file; a 280-line .tsx rides the larger JSX cap (~300)
	writeFileSync(join(dir, 'src/b/huge.ts'), `export const huge = () => 1;\n${'// filler\n'.repeat(300)}`);
	writeFileSync(join(dir, 'src/b/BigView.tsx'), `export const BigView = () => 1;\n${'// filler\n'.repeat(278)}`);

	// dead export vs consumed export
	writeFileSync(join(dir, 'src/a/unusedThing.ts'), 'export const unusedThing = () => 1;\n');
	writeFileSync(join(dir, 'src/a/consumer.ts'), "import { buildLabel } from './helpers';\nexport const consumer = () => buildLabel();\n");

	// test file with a copy of the big body — must NOT produce clone findings
	writeFileSync(join(dir, 'src/a/sumTotals.unit.test.ts'), `const expected = ({ records }: { records: any[] }) => {${bigBody}};\nconsole.log(expected);\n`);

	return dir;
};

test('the standards check finds each planted defect and respects the exceptions', async () => {
	const dir = setupCheckRepo();
	const { findings, notes } = await runStandardsCheck({ cwd: dir });
	const byRule = (rule: string) => findings.filter((finding) => finding.rule === rule);

	// typescript resolved for the AST tier: ${notes.join('; ')}
	expect(notes.some((note) => note.includes('typescript'))).toBeFalsy();
	// without a baseline the accept-debt hint is offered
	expect(notes.some((note) => note.includes('--baseline'))).toBeTruthy();

	const astDups = byRule('ast-duplicate');

	expect(astDups.length).toBe(1);
	// renamed twins caught by normalization
	expect(astDups[0]?.files.map((file) => file.path).sort()).toStrictEqual(['src/a/sumTotals.ts', 'src/b/tallyItems.ts']);

	// token-level clone reported
	expect(byRule('clone').length >= 1).toBeTruthy();
	// test files never appear in findings
	expect(findings.every((finding) => finding.files.every((file) => !file.path.includes('.test.')))).toBeTruthy();

	const names = [...byRule('name-duplicate'), ...byRule('name-synonym')];

	// same-name pair
	expect(names.some((finding) => finding.siteKey === 'name-duplicate:src/a/normalizeRecord.ts|src/b/normalizeRecord.ts')).toBeTruthy();
	// synonym pair collapses to one concept
	expect(names.some((finding) => finding.detail.includes("'fetchUserData'") && finding.detail.includes("'getUserData'"))).toBeTruthy();
	// to/from opposites are deliberate, not duplicates
	expect(names.some((finding) => finding.detail.includes('hexToRgb'))).toBeFalsy();
	// component + kebab route pair is a framework pair
	expect(names.some((finding) => finding.detail.includes('GetStarted'))).toBeFalsy();

	const structure = [...byRule('multi-export'), ...byRule('filename-mismatch'), ...byRule('domain-graduation'), ...byRule('folder-census')];

	// multi-export flagged
	expect(structure.some((finding) => finding.siteKey === 'multi-export:src/a/config.ts')).toBeTruthy();
	// const+type named constant is exempt
	expect(structure.some((finding) => finding.siteKey.includes('Action.ts'))).toBeFalsy();
	// misnamed file flagged
	expect(structure.some((finding) => finding.siteKey === 'filename-mismatch:src/a/helpers.ts')).toBeTruthy();
	// framework dot-suffix is convention, not a mismatch
	expect(structure.some((finding) => finding.siteKey === 'filename-mismatch:src/b/session-response.model.ts')).toBeFalsy();
	// domain-folder candidate
	expect(structure.some((finding) => finding.siteKey === 'domain-graduation:src/a/utils/formatCurrency.ts|src/a/utils/formatDate.ts')).toBeTruthy();

	// oversized file flagged
	expect(byRule('size-file').some((finding) => finding.files[0]?.path === 'src/b/huge.ts')).toBeTruthy();
	// a file over its cap is a rule violation, unlike the per-function size advisory
	expect(byRule('size-file').find((finding) => finding.siteKey === 'size-file:src/b/huge.ts')?.severity).toBe('finding');
	// .tsx under its larger cap not flagged
	expect(byRule('size-file').some((finding) => finding.files[0]?.path === 'src/b/BigView.tsx')).toBeFalsy();

	const dead = byRule('dead-export');

	// dead export flagged
	expect(dead.some((finding) => finding.detail.includes("'unusedThing'"))).toBeTruthy();
	// consumed export not flagged
	expect(dead.some((finding) => finding.detail.includes("'buildLabel'"))).toBeFalsy();
});

test('baseline ratchet: --baseline accepts debt explicitly; later runs report only what is new', async () => {
	const dir = setupCheckRepo();
	const first = await runStandardsCheck({ cwd: dir });

	// a run without a baseline reports the full debt
	expect(first.findings.length > 0).toBeTruthy();
	// a plain run never writes the baseline
	expect(existsSync(join(dir, 'lightsout.standards-baseline.json'))).toBeFalsy();
	// the accept-debt hint is offered
	expect(first.notes.some((note) => note.includes('--baseline'))).toBeTruthy();

	const accepting = await runStandardsCheck({ cwd: dir, writeBaseline: true });

	// the explicit flag writes the committed ledger at the repo root
	expect(existsSync(join(dir, 'lightsout.standards-baseline.json'))).toBeTruthy();
	// the accepting run still reports everything
	expect(accepting.findings.length).toBe(first.findings.length);

	const ledger = JSON.parse(readFileSync(join(dir, 'lightsout.standards-baseline.json'), 'utf8')) as { path: string; siteKeys: string[] };

	// the ledger records the scope it accepted debt for
	expect(ledger.path).toBe('.');
	// it holds one entry per distinct site — the identities later runs measure against
	expect([...ledger.siteKeys].sort()).toStrictEqual([...new Set(accepting.findings.map((finding) => finding.siteKey))].sort());
	// accepting debt says how much of it was accepted:\n${accepting.notes.join('\n')}
	expect(accepting.notes.some((note) => note.includes(`baseline written: ${ledger.siteKeys.length} site(s)`))).toBeTruthy();

	const second = await runStandardsCheck({ cwd: dir });

	// clean re-check is silent: ${second.findings.map((finding) =>
	// finding.siteKey).join(', ')}
	expect(second.findings.length).toBe(0);
	// suppression is stated, not silent
	expect(second.notes.some((note) => note.includes('suppressed'))).toBeTruthy();

	// a new defect lands after the baseline was accepted
	writeFileSync(join(dir, 'src/b/config.ts'), 'export const readConfig = () => 1;\nexport const writeConfig = () => 2;\n');

	const third = await runStandardsCheck({ cwd: dir });

	// the new finding is reported
	expect(third.findings.some((finding) => finding.siteKey === 'multi-export:src/b/config.ts')).toBeTruthy();
	// the baselined site stays suppressed
	expect(third.findings.some((finding) => finding.siteKey === 'multi-export:src/a/config.ts')).toBeFalsy();

	const everything = await runStandardsCheck({ cwd: dir, all: true });

	// --all includes the baselined findings
	expect(everything.findings.length > third.findings.length).toBeTruthy();
});

test('the standards check resolves typescript from workspace packages and honors the per-rule settings', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-standards-ws-'));

	mkdirSync(join(dir, 'packages/app/src'), { recursive: true });
	mkdirSync(join(dir, 'packages/app/node_modules'), { recursive: true });
	// typescript lives ONLY in the workspace package, pnpm-style — the root resolves nothing.
	symlinkSync(join(process.cwd(), 'node_modules/typescript'), join(dir, 'packages/app/node_modules/typescript'), 'dir');
	writeFileSync(join(dir, 'package.json'), '{"name":"ws-fixture"}');
	writeFileSync(join(dir, 'packages/app/package.json'), '{"name":"@ws/app"}');
	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({
			scripts: { check: 'true', testUnit: 'true', testCoverage: false },
			standardsChecks: { clone: { settings: { minTokens: 5000 } }, 'size-file': { settings: { file: 5 } } },
		}),
	);

	writeFileSync(join(dir, 'packages/app/src/sumTotals.ts'), `export const sumTotals = ({ records }: { records: any[] }) => {${bigBody}};\n`);
	writeFileSync(
		join(dir, 'packages/app/src/tallyItems.ts'),
		`export const tallyItems = ({ items }: { items: any[] }) => {\n${bigBody.replace(/records/g, 'items').replace(/record\b/g, 'item').replace(/record\./g, 'item.')}};\n`,
	);

	const { findings, notes } = await runStandardsCheck({ cwd: dir });

	// tier 2 ran via the workspace fallback:\n${notes.join('\n')}
	expect(notes.some((note) => note.includes('typescript'))).toBeFalsy();
	// ast tier found the renamed twins
	expect(findings.some((finding) => finding.rule === 'ast-duplicate')).toBeTruthy();
	// the per-repo clone floor suppressed tier-1 clones
	expect(findings.some((finding) => finding.rule === 'clone')).toBeFalsy();
	// the per-repo size-file cap (5 lines) flagged an ordinary file
	expect(findings.some((finding) => finding.siteKey === 'size-file:packages/app/src/sumTotals.ts')).toBeTruthy();
});

test('the standards check degrades honestly without a resolvable typescript', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-standards-nots-'));

	mkdirSync(join(dir, 'src'), { recursive: true });
	writeFileSync(join(dir, 'src/one.js'), 'export const one = () => 1;\n');
	writeFileSync(join(dir, 'package.json'), '{"name":"fixture-no-ts"}');

	const { notes } = await runStandardsCheck({ cwd: dir });

	// honest skip note:\n${notes.join('\n')}
	expect(notes.some((note) => note.includes('typescript'))).toBeTruthy();
});

test('dead-export: an entry index (imports, no exports) is a consumer, not a barrel', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-standards-entry-'));

	mkdirSync(join(dir, 'src/util'), { recursive: true });
	writeFileSync(join(dir, 'package.json'), '{"name":"fixture-entry"}');

	// Executable entry: imports and CALLS the export, exports nothing itself.
	writeFileSync(join(dir, 'src/run.ts'), 'export const runEverything = () => 1;\n');
	writeFileSync(join(dir, 'src/index.ts'), "import { runEverything } from './run';\nrunEverything();\n");

	// True barrel-only export: re-exported, consumed by nothing.
	writeFileSync(join(dir, 'src/util/helperThing.ts'), 'export const helperThing = () => 1;\n');
	writeFileSync(join(dir, 'src/util/index.ts'), "export { helperThing } from './helperThing';\n");

	const { findings } = await runStandardsCheck({ cwd: dir });
	const dead = findings.filter((finding) => finding.rule.endsWith('-export'));

	// an entry file's imports are consumption:\n${JSON.stringify(dead, undefined,
	// 1)}
	expect(dead.some((finding) => finding.detail.includes('runEverything'))).toBeFalsy();
	// a genuine barrel-only export still flags, under its own rule:\n${JSON.stringify(dead, undefined,
	// 1)}
	expect(dead.some((finding) => finding.rule === 'barrel-only-export' && finding.detail.includes('helperThing'))).toBeTruthy();
});

// Parallel adapters legitimately share their import lists — imports are
// non-deduplicable by construction, so they must never count toward a clone.
const importBlock = [
	"import { readFile, writeFile, appendFile } from 'node:fs/promises';",
	"import { join, resolve, dirname, basename } from 'node:path';",
	"import { createHash, randomUUID } from 'node:crypto';",
	"import type { RunManifest, RunStatus, StepRecord } from './contracts';",
	"import { parseConfig } from './parseConfig';",
	"import { loadPlan } from './loadPlan';",
	"import { resolveScope } from './resolveScope';",
	"import { buildSteps } from './buildSteps';",
	"import './registerSideEffects';",
	'import {',
	'\talpha,',
	'\tbeta,',
	'\tgamma,',
	"} from './greek';",
].join('\n');
const importBlockLines = importBlock.split('\n').length;

test('clone detection ignores import spans but keeps real clones on their true lines', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-standards-imports-'));

	mkdirSync(join(dir, 'src/a'), { recursive: true });
	mkdirSync(join(dir, 'src/b'), { recursive: true });
	writeFileSync(join(dir, 'package.json'), '{"name":"fixture-imports"}');

	// Identical import blocks, unrelated bodies — must NOT clone.
	writeFileSync(join(dir, 'src/a/importHeavyOne.ts'), `${importBlock}\nexport const importHeavyOne = () => parseConfig(loadPlan(alpha));\n`);
	writeFileSync(join(dir, 'src/b/importHeavyTwo.ts'), `${importBlock}\nexport const importHeavyTwo = () => resolveScope(buildSteps(beta, gamma));\n`);

	// Identical import blocks AND an identical body — the body must still be
	// reported as a clone, on its real (post-import) line numbers.
	writeFileSync(join(dir, 'src/a/offsetOne.ts'), `${importBlock}\nexport const offsetOne = ({ records }: { records: any[] }) => {${bigBody}};\n`);
	writeFileSync(join(dir, 'src/b/offsetTwo.ts'), `${importBlock}\nexport const offsetTwo = ({ records }: { records: any[] }) => {${bigBody}};\n`);

	const { findings } = await runStandardsCheck({ cwd: dir });
	const clones = findings.filter((finding) => finding.rule === 'clone');

	// shared import blocks reported as clones:\n${JSON.stringify(clones,
	// undefined, 1)}
	expect(clones.some((finding) => finding.files.some((file) => file.path.includes('importHeavy')))).toBeFalsy();

	const offset = clones.filter((finding) => finding.files.every((file) => file.path.includes('offset')));

	// the duplicated body below the imports still
	// clones:\n${JSON.stringify(clones, undefined, 1)}
	expect(offset.length >= 1).toBeTruthy();
	// clone lines must point below the blanked imports:\n${JSON.stringify(offset,
	// undefined, 1)}
	expect(offset.every((finding) => finding.files.every((file) => (file.startLine ?? 0) > importBlockLines))).toBeTruthy();
});

/** The smallest repo that still yields one known, stable finding site. */
const setupLedgerRepo = ({ ledger }: { ledger?: string } = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-standards-ledger-'));

	mkdirSync(join(dir, 'src/a'), { recursive: true });
	writeFileSync(join(dir, 'src/a/config.ts'), 'export const loadConfig = () => 1;\nexport const saveConfig = () => 2;\n');

	if (ledger !== undefined) {
		writeFileSync(join(dir, 'lightsout.standards-baseline.json'), ledger);
	}

	return dir;
};

test('an unreadable baseline is called out and ignored — nothing is silently suppressed', async () => {
	const dir = setupLedgerRepo({ ledger: '{ this is not json' });

	const { findings, notes } = await runStandardsCheck({ cwd: dir, persist: false });

	// a corrupt ledger states itself:\n${notes.join('\n')}
	expect(notes.some((note) => note.includes('unreadable'))).toBeTruthy();
	// a ledger that could not be read suppresses nothing
	expect(findings.some((finding) => finding.siteKey === 'multi-export:src/a/config.ts')).toBeTruthy();
});

test('a baselined site that no longer exists is reported as burn-down progress', async () => {
	const dir = setupLedgerRepo({
		ledger: JSON.stringify({
			at: '2026-01-01T00:00:00.000Z',
			path: '.',
			siteKeys: ['multi-export:src/a/config.ts', 'multi-export:src/gone/removed.ts'],
		}),
	});

	const { findings, notes } = await runStandardsCheck({ cwd: dir, persist: false });

	// the site still present stays suppressed
	expect(findings.some((finding) => finding.siteKey === 'multi-export:src/a/config.ts')).toBeFalsy();
	// the resolved site is counted as progress:\n${notes.join('\n')}
	expect(notes.some((note) => note.includes('1 baselined site(s) no longer found'))).toBeTruthy();
});

test('re-accepting debt refreshes the ledger to what is true now, dropping the sites already burned down', async () => {
	const dir = setupLedgerRepo({
		ledger: JSON.stringify({
			at: '2026-01-01T00:00:00.000Z',
			path: '.',
			siteKeys: ['multi-export:src/a/config.ts', 'multi-export:src/gone/removed.ts'],
		}),
	});

	const { findings, notes } = await runStandardsCheck({ cwd: dir, writeBaseline: true, persist: false });

	const ledger = JSON.parse(readFileSync(join(dir, 'lightsout.standards-baseline.json'), 'utf8')) as { path: string; siteKeys: string[] };

	// the rewritten ledger holds exactly the sites this run found
	expect([...ledger.siteKeys].sort()).toStrictEqual([...new Set(findings.map((finding) => finding.siteKey))].sort());
	// a site that no longer exists is not carried forward
	expect(ledger.siteKeys.includes('multi-export:src/gone/removed.ts')).toBeFalsy();
	// an existing ledger is refreshed, not written for the first time:\n${notes.join('\n')}
	expect(notes.some((note) => note.includes('baseline refreshed'))).toBeTruthy();
});

test('runStandardsCheck reports stage progress and leaves the evidence file alone when told not to persist', async () => {
	const dir = setupLedgerRepo();
	const messages: string[] = [];

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false, onProgress: (message) => messages.push(message) });

	// the opening progress line counts the scope: ${messages[0]}
	expect(messages[0]?.includes('1 source file(s)')).toBeTruthy();
	// progress is reported through the last stage:\n${messages.join('\n')}
	expect(messages.some((message) => message.includes('dead-exports: done'))).toBeTruthy();
	// the check still reports its findings
	expect(findings.length > 0).toBeTruthy();
	// persist: false never clobbers the standalone report
	expect(existsSync(join(dir, '.lightsout/standards-check.json'))).toBeFalsy();
});

test('a persisting run writes the typed evidence file it returns', async () => {
	const dir = setupLedgerRepo();

	const { findings, notes } = await runStandardsCheck({ cwd: dir });

	const raw = readFileSync(join(dir, '.lightsout/standards-check.json'), 'utf8');
	const report = JSON.parse(raw) as { path: string; findings: Array<{ siteKey: string }>; notes: string[] };
	// a whole-repo run records the root as its scope
	expect(report.path).toBe('.');
	// the file holds what the caller got
	expect(report.findings.map((finding) => finding.siteKey).sort()).toStrictEqual(findings.map((finding) => finding.siteKey).sort());
	// the notes travel with the findings
	expect(report.notes).toStrictEqual(notes);
});

/** A repo whose whole report lands in one folder — 22 two-export files, well clear of the 20-finding floor the dominance diagnosis needs. */
const setupCrowdedRepo = ({ folder }: { folder: string }) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-standards-crowded-'));

	mkdirSync(join(dir, folder), { recursive: true });

	for (let index = 0; index < 22; index += 1) {
		writeFileSync(join(dir, folder, `widget${index}.ts`), `export const openWidget${index} = () => 1;\nexport const closeWidget${index} = () => 2;\n`);
	}

	return dir;
};

test('a report dominated by one directory says so, naming the config list that would exclude it', async () => {
	const dir = setupCrowdedRepo({ folder: 'src/generated' });

	const { findings, notes } = await runStandardsCheck({ cwd: dir, persist: false });

	// the whole report sits under one directory:\n${notes.join('\n')}
	expect(notes.some((note) => note.includes('sit under src/generated/'))).toBeTruthy();
	// naming the directory is only half of it — the note says what to do about it
	expect(notes.some((note) => note.includes('"generated" list'))).toBeTruthy();
	// the diagnosis is an extra note, never a reason to report fewer findings
	expect(findings.length > 20).toBeTruthy();
});

/** A crowded report whose dominant tree forks in two, with a minority of findings outside that tree entirely. */
const setupForkedRepo = () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-standards-forked-'));

	mkdirSync(join(dir, 'src/generated/alpha'), { recursive: true });
	mkdirSync(join(dir, 'src/generated/beta'), { recursive: true });
	mkdirSync(join(dir, 'lib'), { recursive: true });

	for (let index = 0; index < 10; index += 1) {
		writeFileSync(join(dir, 'src/generated/alpha', `partOne${index}.ts`), `export const openPartOne${index} = () => 1;\nexport const closePartOne${index} = () => 2;\n`);
		writeFileSync(join(dir, 'src/generated/beta', `sideTwo${index}.ts`), `export const openSideTwo${index} = () => 1;\nexport const closeSideTwo${index} = () => 2;\n`);
	}

	for (let index = 0; index < 4; index += 1) {
		writeFileSync(join(dir, 'lib', `thing${index}.ts`), `export const openThing${index} = () => 1;\nexport const closeThing${index} = () => 2;\n`);
	}

	return dir;
};

test('the dominant directory is the deepest one still holding the majority, counting the findings that sit outside it', async () => {
	const dir = setupForkedRepo();

	const { findings, notes } = await runStandardsCheck({ cwd: dir, persist: false });

	// the walk descends to the crowded tree:\n${notes.join('\n')}
	expect(notes.some((note) => note.includes('sit under src/generated/'))).toBe(true);
	// and stops where it forks — neither branch holds a majority of the whole report
	expect(notes.some((note) => note.includes('src/generated/alpha') || note.includes('src/generated/beta'))).toBe(false);
	// the findings outside the tree are real, so the share is a share, not a whole
	expect(findings.some((finding) => finding.files[0]?.path.startsWith('lib/'))).toBe(true);
	expect(notes.some((note) => note.includes('100% of findings'))).toBe(false);
});

test('a directory one segment deep is not a diagnosis — a whole src/ tree is where code lives, not a config gap', async () => {
	const dir = setupCrowdedRepo({ folder: 'src' });

	const { findings, notes } = await runStandardsCheck({ cwd: dir, persist: false });

	// no directory deep enough to blame:\n${notes.join('\n')}
	expect(notes.some((note) => note.includes('sit under'))).toBeFalsy();
	// the same crowded report is still returned in full
	expect(findings.length > 20).toBeTruthy();
});
