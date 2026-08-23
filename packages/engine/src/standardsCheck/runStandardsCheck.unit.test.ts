import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { runStandardsCheck } from '#src/standardsCheck/index.ts';

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
	writeFileSync(
		join(dir, 'src/b/tallyItems.ts'),
		`export const tallyItems = ({ items }: { items: any[] }) => {\n${bigBody
			.replace(/records/g, 'items')
			.replace(/record\b/g, 'item')
			.replace(/record\./g, 'item.')}};\n`,
	);

	// tier 0: synonym pair + same-name pair
	writeFileSync(join(dir, 'src/a/getUserData.ts'), 'export const getUserData = () => 1;\n');
	writeFileSync(join(dir, 'src/b/fetchUserData.ts'), 'export const fetchUserData = () => 2;\n');
	writeFileSync(join(dir, 'src/a/normalizeRecord.ts'), 'export const normalizeRecord = () => 1;\n');
	writeFileSync(join(dir, 'src/b/normalizeRecord.ts'), 'export const normalizeRecord = () => 2;\n');

	// structure: multi-export violation, misnamed file, domain-folder candidates
	writeFileSync(join(dir, 'src/a/config.ts'), 'export const readConfig = () => 1;\nexport const saveConfig = () => 2;\n');
	writeFileSync(join(dir, 'src/a/helpers.ts'), 'export const buildLabel = () => 1;\n');
	writeFileSync(join(dir, 'src/a/utils/formatDate.ts'), 'export const formatDate = () => 1;\n');
	writeFileSync(join(dir, 'src/a/utils/formatCurrency.ts'), 'export const formatCurrency = () => 1;\n');

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
	const structure = [...byRule('multi-export'), ...byRule('filename-mismatch'), ...byRule('domain-graduation'), ...byRule('folder-census')];

	// multi-export flagged
	expect(structure.some((finding) => finding.siteKey === 'multi-export:src/a/config.ts')).toBeTruthy();
	// misnamed file flagged
	expect(structure.some((finding) => finding.siteKey === 'filename-mismatch:src/a/helpers.ts')).toBeTruthy();
	// domain-folder candidate
	expect(structure.some((finding) => finding.siteKey === 'domain-graduation:src/a/utils/formatCurrency.ts|src/a/utils/formatDate.ts')).toBeTruthy();

	// oversized file flagged
	expect(byRule('size-file').some((finding) => finding.files[0]?.path === 'src/b/huge.ts')).toBeTruthy();
	// a cap is a layout opinion: the pack ships it advisory, and a repo that wants
	// it to block promotes it in standards-checks (this one has none)
	expect(byRule('size-file').find((finding) => finding.siteKey === 'size-file:src/b/huge.ts')?.severity).toBe('advisory');
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

/** The smallest repo that still yields one known, stable finding site. */
const setupLedgerRepo = ({ ledger }: { ledger?: string } = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-standards-ledger-'));

	mkdirSync(join(dir, 'src/a'), { recursive: true });
	writeFileSync(join(dir, 'src/a/config.ts'), 'export const readConfig = () => 1;\nexport const saveConfig = () => 2;\n');

	if (ledger !== undefined) {
		writeFileSync(join(dir, 'lightsout.standards-baseline.json'), ledger);
	}

	return dir;
};

test('runStandardsCheck reports stage progress and leaves the evidence file alone when told not to persist', async () => {
	const dir = setupLedgerRepo();
	const messages: string[] = [];

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false, onProgress: (message) => messages.push(message) });

	// the opening progress line counts the scope: ${messages[0]}
	expect(messages[0]?.includes('1 source file(s)')).toBeTruthy();
	// progress is reported per input kind, through the last one that had rules
	// to run:\n${messages.join('\n')}
	expect(messages).toContain('file-text: done');
	// the check still reports its findings
	expect(findings.length > 0).toBeTruthy();
	// persist: false never clobbers the standalone report
	expect(existsSync(join(dir, '.lightsout/standards-check.json'))).toBeFalsy();
	// nor does an in-pipeline run contribute a point to the standards trend
	expect(existsSync(join(dir, '.lightsout/standards-check'))).toBeFalsy();
});

test('a persisting run writes the typed evidence file it returns', async () => {
	const dir = setupLedgerRepo();

	const { findings, notes } = await runStandardsCheck({ cwd: dir });

	const raw = readFileSync(join(dir, '.lightsout/standards-check.json'), 'utf8');
	const report = JSON.parse(raw) as { at: string; path: string; findings: Array<{ siteKey: string }>; notes: string[] };
	// a whole-repo run records the root as its scope
	expect(report.path).toBe('.');
	// the file holds what the caller got
	expect(report.findings.map((finding) => finding.siteKey).sort()).toStrictEqual(findings.map((finding) => finding.siteKey).sort());
	// the notes travel with the findings
	expect(report.notes).toStrictEqual(notes);

	const dated = readdirSync(join(dir, '.lightsout/standards-check'));

	// the same writer leaves a dated copy beside it, byte for byte
	expect(dated.length).toBe(1);
	expect(readFileSync(join(dir, '.lightsout/standards-check', dated[0]), 'utf8')).toBe(raw);
	// named for the moment the check ran, with nothing a filesystem refuses
	expect(dated[0]).toBe(`${report.at.replaceAll(':', '-').replaceAll('.', '-')}.json`);
});

/** Write a set of repo-relative files under `dir`, creating the folders they need. */
const writeTree = ({ dir, files }: { dir: string; files: Record<string, string> }) => {
	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}
};

/**
 * A standards pack of somebody's own: one document, one rule, one check that
 * flags every source file it is handed. The check is written the way a pack
 * author writes one — a `check` export naming its input kind, and no engine
 * import at run time.
 *
 * It sits outside the repo it checks, so the pack's own files never show up
 * in that repo's file list.
 */
const writeOwnPack = () => {
	const packPath = mkdtempSync(join(tmpdir(), 'lightsout-house-standards-'));

	writeTree({
		dir: packPath,
		files: {
			'lightsout-standards.json': '{ "name": "acme", "formatVersion": 1 }\n',
			'code/house/document.md': '# House Style\n\nWhat this shop agrees on.\n',
			'code/house/05-house-no-loose-files/rule.md':
				'---\nsummary: a source file outside a module\nchecked: true\nseverity: blocking\n---\n\nEvery file belongs to a module.\n',
			'code/house/05-house-no-loose-files/check.ts':
				'export const check = {\n' +
				"\tinputKind: 'file-list',\n" +
				'\trun: ({ input }) => input.files.map((path) => ({ siteKey: `house-no-loose-files:${path}`, files: [{ path }], detail: `${path} sits outside a module` })),\n' +
				'};\n',
			'code/house/05-house-no-loose-files/fixtures/pass/src/mod/index.ts': 'export const mod = 1;\n',
			'code/house/05-house-no-loose-files/fixtures/fail/src/loose.ts': 'export const loose = 1;\n',
		},
	});

	return packPath;
};

/** A repo whose config brings the house pack instead of the bundled defaults. */
const setupOwnPackRepo = () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-standards-own-'));

	writeTree({
		dir,
		files: {
			'src/alpha.ts': 'export const alpha = 1;\n',
			'src/beta.ts': 'export const beta = 2;\n',
			'lightsout.config.json': JSON.stringify({
				gates: { check: 'true', test: 'true', 'test-coverage': false },
				'standards-packs': [writeOwnPack()],
			}),
		},
	});

	return dir;
};

test("a repo's own standards pack supplies the rules, and the bundled defaults do not run beside them", async () => {
	const dir = setupOwnPackRepo();

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

	// the rule id comes from the folder the check was loaded from, and the
	// severity from that rule's own declaration
	expect(findings.map((finding) => `${finding.rule} ${finding.severity} ${finding.siteKey}`).sort()).toStrictEqual([
		'house-no-loose-files blocking house-no-loose-files:src/alpha.ts',
		'house-no-loose-files blocking house-no-loose-files:src/beta.ts',
	]);
});

/** A repo on the house pack whose source spans a nested folder, so a scope has something to bite on. */
const setupScopedRepo = () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-standards-scope-'));

	writeTree({
		dir,
		files: {
			'src/keep.ts': 'export const keep = 1;\n',
			'src/core/inner.ts': 'export const inner = 2;\n',
			'lightsout.config.json': JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': false }, 'standards-packs': [writeOwnPack()] }),
		},
	});

	return dir;
};

test('--path checks the subpath it was given, and the evidence file records that scope', async () => {
	const dir = setupScopedRepo();

	const { findings } = await runStandardsCheck({ cwd: dir, path: 'src/core' });

	const report = JSON.parse(readFileSync(join(dir, '.lightsout/standards-check.json'), 'utf8')) as { path: string };
	// the files outside the scope are never handed to a check
	expect(findings.map((finding) => finding.siteKey)).toStrictEqual(['house-no-loose-files:src/core/inner.ts']);
	// a scoped report says what it covered, so nobody reads it as the whole repo
	expect(report.path).toBe('src/core');
});

/** The check a house rule ships: one finding per source file, so which rules actually ran is readable straight off the report. */
const houseCheckSource = ({ ruleId }: { ruleId: string }) =>
	'export const check = {\n' +
	"\tinputKind: 'file-list',\n" +
	`\trun: ({ input }) => input.files.map((path) => ({ siteKey: \`${ruleId}:\${path}\`, files: [{ path }], detail: 'every file belongs to a module' })),\n` +
	'};\n';

/** One rule folder's files: its declaration, its check, and the fixture pair every rule ships. */
const houseRuleFiles = ({ documentPath, ruleId }: { documentPath: string; ruleId: string }) => ({
	[`${documentPath}/05-${ruleId}/rule.md`]: '---\nsummary: a source file outside a module\nchecked: true\n---\n\nEvery file belongs to a module.\n',
	[`${documentPath}/05-${ruleId}/check.ts`]: houseCheckSource({ ruleId }),
	[`${documentPath}/05-${ruleId}/fixtures/pass/src/mod/index.ts`]: 'export const mod = 1;\n',
	[`${documentPath}/05-${ruleId}/fixtures/fail/src/loose.ts`]: 'export const loose = 1;\n',
});

/** A pack whose second document is framework-scoped — the channel gate needs a rule on each side of it. */
const writeChannelPack = () => {
	const packPath = mkdtempSync(join(tmpdir(), 'lightsout-channel-standards-'));

	writeTree({
		dir: packPath,
		files: {
			'lightsout-standards.json': '{ "name": "acme-channels", "formatVersion": 1 }\n',
			'code/house/document.md': '# House Style\n\nWhat this shop agrees on everywhere.\n',
			...houseRuleFiles({ documentPath: 'code/house', ruleId: 'house-any-file' }),
			'code/react/document.md': '---\nchannel: react\n---\n\n# React Style\n\nWhat this shop agrees on in React.\n',
			...houseRuleFiles({ documentPath: 'code/react', ruleId: 'house-react-file' }),
		},
	});

	return packPath;
};

/** A repo with one source file, whose root manifest and config between them decide which framework channels are in play. */
const setupChannelRepo = ({ dependencies = {}, standardsChannels }: { dependencies?: Record<string, string>; standardsChannels?: string[] }) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-standards-channel-'));

	writeTree({
		dir,
		files: {
			'package.json': JSON.stringify({ name: 'channel-fixture', dependencies }),
			'src/alpha.ts': 'export const alpha = 1;\n',
			'lightsout.config.json': JSON.stringify({
				gates: { check: 'true', test: 'true', 'test-coverage': false },
				'standards-packs': [writeChannelPack()],
				...(standardsChannels ? { 'standards-channels': standardsChannels } : {}),
			}),
		},
	});

	return dir;
};

test("a framework rule runs when the repo's own manifest shows it is in that framework", async () => {
	const dir = setupChannelRepo({ dependencies: { react: '^19.0.0' } });

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

	// channels are detected from the root package.json, so no config is needed
	// to put a React repo's React rules in play
	expect(findings.map((finding) => finding.rule).sort()).toStrictEqual(['house-any-file', 'house-react-file']);
});

test('a configured channel list is the whole answer, overriding what the manifest would have detected', async () => {
	const dir = setupChannelRepo({ dependencies: { react: '^19.0.0' }, standardsChannels: [] });

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

	// an explicit list wins even where detection would have said otherwise —
	// prose and checks read the same answer
	expect(findings.map((finding) => finding.rule)).toStrictEqual(['house-any-file']);
});
