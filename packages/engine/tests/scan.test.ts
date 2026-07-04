import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runScan } from '../src/index';

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

/** A consumer repo with one planted defect per detector. */
const setupScanRepo = () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-scan-test-'));

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

test('scan finds each planted defect and respects the exceptions', async () => {
	const dir = setupScanRepo();
	const { findings, notes } = await runScan({ cwd: dir });
	const byDetector = (detector: string) => findings.filter((finding) => finding.detector === detector);

	assert.ok(!notes.some((note) => note.includes('typescript')), `typescript resolved for the AST tier: ${notes.join('; ')}`);
	assert.ok(
		notes.some((note) => note.includes('--baseline')),
		'without a baseline the accept-debt hint is offered',
	);

	const astDups = byDetector('ast-duplicate');

	assert.equal(astDups.length, 1, JSON.stringify(astDups));
	assert.deepEqual(
		astDups[0]?.files.map((file) => file.path).sort(),
		['src/a/sumTotals.ts', 'src/b/tallyItems.ts'],
		'renamed twins caught by normalization',
	);

	assert.ok(byDetector('clone').length >= 1, 'token-level clone reported');
	assert.ok(
		findings.every((finding) => finding.files.every((file) => !file.path.includes('.test.'))),
		'test files never appear in findings',
	);

	const names = byDetector('filename-duplicate');

	assert.ok(names.some((finding) => finding.cluster === 'name:normalizeRecord'), 'same-name pair');
	assert.ok(
		names.some((finding) => finding.detail.includes("'fetchUserData'") && finding.detail.includes("'getUserData'")),
		'synonym pair collapses to one concept',
	);
	assert.ok(!names.some((finding) => finding.detail.includes('hexToRgb')), 'to/from opposites are deliberate, not duplicates');
	assert.ok(!names.some((finding) => finding.detail.includes('GetStarted')), 'component + kebab route pair is a framework pair');

	const structure = byDetector('structure');

	assert.ok(structure.some((finding) => finding.cluster === 'multi-export:src/a/config.ts'), 'multi-export flagged');
	assert.ok(!structure.some((finding) => finding.cluster.includes('Action.ts')), 'const+type named constant is exempt');
	assert.ok(structure.some((finding) => finding.cluster === 'filename-mismatch:src/a/helpers.ts'), 'misnamed file flagged');
	assert.ok(
		!structure.some((finding) => finding.cluster === 'filename-mismatch:src/b/session-response.model.ts'),
		'framework dot-suffix is convention, not a mismatch',
	);
	assert.ok(structure.some((finding) => finding.cluster === 'domain:src/a/utils:format'), 'domain-folder candidate');

	assert.ok(byDetector('size').some((finding) => finding.files[0]?.path === 'src/b/huge.ts'), 'oversized file flagged');
	assert.ok(!byDetector('size').some((finding) => finding.files[0]?.path === 'src/b/BigView.tsx'), '.tsx under its larger cap not flagged');

	const dead = byDetector('dead-export');

	assert.ok(dead.some((finding) => finding.detail.includes("'unusedThing'")), 'dead export flagged');
	assert.ok(!dead.some((finding) => finding.detail.includes("'buildLabel'")), 'consumed export not flagged');
});

test('scan baseline ratchet: --baseline accepts debt explicitly; later scans report only what is new', async () => {
	const dir = setupScanRepo();
	const first = await runScan({ cwd: dir });

	assert.ok(first.findings.length > 0, 'scan without a baseline reports the full debt');
	assert.ok(!existsSync(join(dir, 'lightsout.scan-baseline.json')), 'a plain scan never writes the baseline');
	assert.ok(
		first.notes.some((note) => note.includes('--baseline')),
		'the accept-debt hint is offered',
	);

	const accepting = await runScan({ cwd: dir, writeBaseline: true });

	assert.ok(existsSync(join(dir, 'lightsout.scan-baseline.json')), 'the explicit flag writes the committed ledger at the repo root');
	assert.equal(accepting.findings.length, first.findings.length, 'the accepting run still reports everything');

	const second = await runScan({ cwd: dir });

	assert.equal(second.findings.length, 0, `clean re-scan is silent: ${second.findings.map((finding) => finding.cluster).join(', ')}`);
	assert.ok(
		second.notes.some((note) => note.includes('suppressed')),
		'suppression is stated, not silent',
	);

	// a new defect lands after the baseline was accepted
	writeFileSync(join(dir, 'src/b/config.ts'), 'export const readConfig = () => 1;\nexport const writeConfig = () => 2;\n');

	const third = await runScan({ cwd: dir });

	assert.ok(
		third.findings.some((finding) => finding.cluster === 'multi-export:src/b/config.ts'),
		'the new finding is reported',
	);
	assert.ok(
		!third.findings.some((finding) => finding.cluster === 'multi-export:src/a/config.ts'),
		'the baselined cluster stays suppressed',
	);

	const everything = await runScan({ cwd: dir, all: true });

	assert.ok(everything.findings.length > third.findings.length, '--all includes the baselined findings');
});

test('scan resolves typescript from workspace packages and honors scan.minCloneTokens', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-scan-ws-'));

	mkdirSync(join(dir, 'packages/app/src'), { recursive: true });
	mkdirSync(join(dir, 'packages/app/node_modules'), { recursive: true });
	// typescript lives ONLY in the workspace package, pnpm-style — the root resolves nothing.
	symlinkSync(join(process.cwd(), 'node_modules/typescript'), join(dir, 'packages/app/node_modules/typescript'), 'dir');
	writeFileSync(join(dir, 'package.json'), '{"name":"ws-fixture"}');
	writeFileSync(join(dir, 'packages/app/package.json'), '{"name":"@ws/app"}');
	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({ scripts: { check: 'true', testUnit: 'true', testCoverage: false }, scan: { minCloneTokens: 5000 } }),
	);

	writeFileSync(join(dir, 'packages/app/src/sumTotals.ts'), `export const sumTotals = ({ records }: { records: any[] }) => {${bigBody}};\n`);
	writeFileSync(
		join(dir, 'packages/app/src/tallyItems.ts'),
		`export const tallyItems = ({ items }: { items: any[] }) => {\n${bigBody.replace(/records/g, 'items').replace(/record\b/g, 'item').replace(/record\./g, 'item.')}};\n`,
	);

	const { findings, notes } = await runScan({ cwd: dir });

	assert.ok(!notes.some((note) => note.includes('typescript')), `tier 2 ran via the workspace fallback:\n${notes.join('\n')}`);
	assert.ok(
		findings.some((finding) => finding.detector === 'ast-duplicate'),
		'ast tier found the renamed twins',
	);
	assert.ok(
		!findings.some((finding) => finding.detector === 'clone'),
		'the per-repo minCloneTokens floor suppressed tier-1 clones',
	);
});

test('scan degrades honestly without a resolvable typescript', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-scan-nots-'));

	mkdirSync(join(dir, 'src'), { recursive: true });
	writeFileSync(join(dir, 'src/one.js'), 'export const one = () => 1;\n');
	writeFileSync(join(dir, 'package.json'), '{"name":"fixture-no-ts"}');

	const { notes } = await runScan({ cwd: dir });

	assert.ok(notes.some((note) => note.includes('typescript')), `honest skip note:\n${notes.join('\n')}`);
});
