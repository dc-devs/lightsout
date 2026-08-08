import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { StandardsPassId, StandardsSeverity } from '@/contracts';
import { runStandardsCheck, selectStandardsFindings } from '@/standardsCheck';
import { buildSiteKey } from '@/standardsCheck/common/utils/buildSiteKey';

/**
 * One repo carrying a planted violation for several rules at once, so a single
 * config change can be watched moving one rule without disturbing the rest.
 */
const setupRegistryRepo = ({ standardsChecks, typescript = true }: { standardsChecks?: Record<string, unknown>; typescript?: boolean } = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-registry-'));
	const files: Record<string, string> = {
		// multi-export (finding) + filename-mismatch (advisory)
		'src/pay/config.ts': 'export const loadConfig = () => 1;\nexport const saveConfig = () => 2;\n',
		'src/pay/helpers.ts': 'export const buildLabel = () => 1;\n',
		// module-boundary (finding)
		'src/mod/index.ts': "export { entry } from './entry';\n",
		'src/mod/entry.ts': 'export const entry = 1;\n',
		'src/mod/hidden.ts': 'export const hidden = 2;\n',
		'src/outside/reach.ts': "import { hidden } from '../mod/hidden';\n\nexport const reach = hidden;\n",
		// name-duplicate (advisory)
		'src/pay/normalizeRecord.ts': 'export const normalizeRecord = () => 1;\n',
		'src/mod/normalizeRecord.ts': 'export const normalizeRecord = () => 2;\n',
	};

	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}

	if (typescript) {
		mkdirSync(join(dir, 'node_modules'), { recursive: true });
		symlinkSync(join(process.cwd(), 'node_modules/typescript'), join(dir, 'node_modules/typescript'), 'dir');
	}

	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({ scripts: { check: 'true', testUnit: 'true', testCoverage: false }, ...(standardsChecks ? { standardsChecks } : {}) }),
	);

	return dir;
};

const check = (dir: string) => runStandardsCheck({ cwd: dir, persist: false });

describe('runStandardsCheck against the rule registry', () => {
	test('a rule switched off produces no findings, and takes nothing else with it', async () => {
		const before = await check(setupRegistryRepo());
		const after = await check(setupRegistryRepo({ standardsChecks: { 'multi-export': 'off' } }));

		// the rule really does fire in this fixture, so its absence below is not vacuous
		expect(before.findings.some((finding) => finding.rule === 'multi-export')).toBe(true);
		// `off` is a configuration state — it never reaches a persisted finding
		expect(after.findings.some((finding) => finding.rule === 'multi-export')).toBe(false);
		// its pass-mate keeps reporting: severity is per rule, not per pass
		expect(after.findings.some((finding) => finding.rule === 'filename-mismatch')).toBe(true);
	});

	test('a whole pass is skipped when every rule mapped to it is off', async () => {
		const dir = setupRegistryRepo({ standardsChecks: { 'name-duplicate': 'off', 'name-synonym': 'off' } });
		const messages: string[] = [];

		const { findings } = await runStandardsCheck({ cwd: dir, persist: false, onProgress: (message) => messages.push(message) });

		expect(findings.some((finding) => finding.rule === 'name-duplicate' || finding.rule === 'name-synonym')).toBe(false);
		// and the run says so rather than reporting a pass it never ran:\n${messages.join('\n')}
		expect(messages).toContain('filename-duplicates: off');
	});

	test('every pass in the table runs, in tier order', async () => {
		const dir = setupRegistryRepo();
		const messages: string[] = [];

		await runStandardsCheck({ cwd: dir, persist: false, onProgress: (message) => messages.push(message) });

		// the order is part of the contract: the cheap name-level work first, the
		// compiler-gated work once typescript has resolved, and the test-file pass
		// last
		expect(messages.filter((message) => message.endsWith(': done'))).toStrictEqual([
			'filename-duplicates: done',
			'clones: done',
			'ast-findings: done',
			'module-boundaries: done',
			'placement: done',
			'barrel-hygiene: done',
			'structure: done',
			'dead-exports: done',
			'test-shape: done',
		]);
		// nothing sat out — a pass no rule maps to would report itself off here and
		// then silently never run
		expect(messages.some((message) => message.endsWith(': off'))).toBe(false);
	});

	test('the pass vocabulary is exactly those nine ids and nothing else', () => {
		const passes = [...Object.values(StandardsPassId)].sort();

		// a pass id is what every rule in the registry names as its producer, what
		// the progress output prints, and what the typescript skip note lists — an
		// id added or renamed without being restated here changes all three at once
		expect(passes).toStrictEqual([
			'ast-findings',
			'barrel-hygiene',
			'clones',
			'dead-exports',
			'filename-duplicates',
			'module-boundaries',
			'placement',
			'structure',
			'test-shape',
		]);
	});

	test('every id in the vocabulary is walked by a run, exactly once', async () => {
		const dir = setupRegistryRepo();
		const messages: string[] = [];

		await runStandardsCheck({ cwd: dir, persist: false, onProgress: (message) => messages.push(message) });
		const walked = messages.filter((message) => message.endsWith(': done') || message.endsWith(': off')).map((message) => message.split(':')[0]);

		// the pass table is the only thing that turns an id into work: an id declared
		// here and left out of the table is a pass that never runs and never says so,
		// and one listed twice runs its rules twice:\n${messages.join('\n')}
		expect(walked.sort()).toStrictEqual([...Object.values(StandardsPassId)].sort());
	});

	test('the typescript skip note names the passes actually skipped, not a hard-coded list', async () => {
		const dir = setupRegistryRepo({ typescript: false });

		const { notes } = await runStandardsCheck({ cwd: dir, persist: false });
		const note = notes.find((entry) => entry.includes('no typescript resolvable'));

		// only the compiler-gated passes: the text-level ones ran, and blaming them
		// on a missing compiler would be a lie a later rule could not correct
		expect(Object.values(StandardsPassId).filter((id) => note?.includes(id))).toStrictEqual(['ast-findings', 'module-boundaries', 'placement']);
	});

	test('a pass the repo switched off is not reported as a typescript casualty', async () => {
		const dir = setupRegistryRepo({ typescript: false, standardsChecks: { 'ast-duplicate': 'off', 'size-file': 'off', 'size-function': 'off' } });
		const messages: string[] = [];

		const { notes } = await runStandardsCheck({ cwd: dir, persist: false, onProgress: (message) => messages.push(message) });
		const note = notes.find((entry) => entry.includes('no typescript resolvable'));

		// off is a policy the repo chose, not a degraded run:\n${messages.join('\n')}
		expect(messages).toContain('ast-findings: off');
		// and the passes it did not switch off are still reported honestly
		expect(Object.values(StandardsPassId).filter((id) => note?.includes(id))).toStrictEqual(['module-boundaries', 'placement']);
	});

	test('a rule dropped to advisory stops blocking while still being reported', async () => {
		const dir = setupRegistryRepo({ standardsChecks: { 'module-boundary': 'advisory' } });

		const { findings } = await check(dir);
		const boundary = findings.find((finding) => finding.rule === 'module-boundary');
		const selected = selectStandardsFindings({ findings, changedFiles: ['src/outside/reach.ts'] });

		// the finding is still found — the repo asked for guidance, not blindness
		expect(boundary?.severity).toBe(StandardsSeverity.Advisory);
		// severity is the only gate lever, so it is out of the work-list
		expect(selected.workList.some((finding) => finding.rule === 'module-boundary')).toBe(false);
		expect(selected.advisories.some((finding) => finding.rule === 'module-boundary')).toBe(true);
	});

	test('a rule raised to finding starts blocking', async () => {
		const dir = setupRegistryRepo({ standardsChecks: { 'filename-mismatch': 'finding' } });

		const { findings } = await check(dir);
		const selected = selectStandardsFindings({ findings, changedFiles: ['src/pay/helpers.ts'] });

		expect(findings.find((finding) => finding.rule === 'filename-mismatch')?.severity).toBe(StandardsSeverity.Finding);
		expect(selected.workList.map((finding) => finding.rule)).toContain('filename-mismatch');
	});

	test('a settings override reaches the pass that owns the rule', async () => {
		const dir = setupRegistryRepo({ standardsChecks: { 'folder-census': { settings: { cap: 2 } } } });

		const { findings } = await check(dir);
		const census = findings.filter((finding) => finding.rule === 'folder-census');

		// three files in src/pay and four in src/mod clear a cap of two, which the
		// default twenty would never catch
		expect(census.map((finding) => finding.siteKey).sort()).toStrictEqual(['folder-census:src/mod', 'folder-census:src/pay']);
	});

	test('every finding a run reports is keyed by buildSiteKey — no pass hand-rolls its own', async () => {
		const { findings } = await check(setupRegistryRepo());

		// the invariant the debt ledger and the gate both rest on
		expect(findings.length > 0).toBe(true);
		expect(findings.filter((finding) => finding.siteKey !== buildSiteKey({ rule: finding.rule, files: finding.files }))).toStrictEqual([]);
	});

	test('a site key carries no line number, symbol name or hash', async () => {
		const { findings } = await check(setupRegistryRepo());

		for (const finding of findings) {
			const paths = [...new Set(finding.files.map((file) => file.path))].sort();

			// an edit above a site must not re-mint its identity
			expect(finding.siteKey).toBe(`${finding.rule}:${paths.join('|')}`);
		}
	});
});
