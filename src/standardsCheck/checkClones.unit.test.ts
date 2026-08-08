import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { runStandardsCheck } from '@/standardsCheck';

// checkClones is a standards-check internal: tier 1 runs inside runStandardsCheck, so
// its clone spans are observable only as the findings the check reports. Tier 1 needs no
// compiler, so this fixture ships no typescript symlink.

// Well past the tier-1 floor (50 tokens / 5 lines) so the duplicated span is
// unambiguously a clone.
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

/** A second span, unrelated to the first, so one file pair can hold two clones. */
const otherBody = `
	const seen = new Map<string, number>();
	for (const entry of records) {
		const previous = seen.get(entry.label) ?? 0;
		if (entry.weight > previous && entry.label.length > 3) {
			seen.set(entry.label, entry.weight + previous * 2);
		} else {
			seen.set(entry.label, previous - entry.weight);
		}
	}
	return [...seen.values()].reduce((sum, value) => sum + value, 0);
`;

const setupClonedRepo = () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-clones-'));

	mkdirSync(join(dir, 'src/a'), { recursive: true });
	mkdirSync(join(dir, 'src/b'), { recursive: true });
	writeFileSync(join(dir, 'src/a/alpha.ts'), `export const alpha = ({ records }: { records: any[] }) => {${bigBody}};\n`);
	writeFileSync(join(dir, 'src/b/beta.ts'), `export const beta = ({ records }: { records: any[] }) => {${bigBody}};\n`);

	// A dangling symlink is listed as a source file but can never be read —
	// the tier must skip it and carry on, not abort the whole run.
	symlinkSync(join(dir, 'src/no-such-file.ts'), join(dir, 'src/broken.ts'));

	return dir;
};

test('tier 1 reports the duplicated span across both files', async () => {
	const dir = setupClonedRepo();

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

	const clones = findings.filter((finding) => finding.rule === 'clone');
	// the copied body clones:\n${JSON.stringify(clones, undefined, 1)}
	expect(clones.some((finding) => {
		const paths = finding.files.map((file) => file.path).sort();

		return paths[0] === 'src/a/alpha.ts' && paths[1] === 'src/b/beta.ts';
	})).toBeTruthy();
	// every clone carries a real line span
	expect(clones.every((finding) => finding.files.every((file) => (file.startLine ?? 0) >= 1 && (file.endLine ?? 0) >= (file.startLine ?? 0)))).toBeTruthy();
	// a raw-text span may be a fragment with no clean extraction, and the rule's own
	// guidance leaves room to justify the copies — advisory, never blocking
	expect(clones.every((finding) => finding.severity === 'advisory')).toBeTruthy();
	// the site key is the rule and the paths, with no line number to re-mint the
	// identity on an edit above the span:\n${JSON.stringify(clones, undefined, 1)}
	expect(clones.map((finding) => finding.siteKey)).toStrictEqual(['clone:src/a/alpha.ts|src/b/beta.ts']);
	// the detail counts the spans rather than splitting them into separate findings
	expect(clones[0]?.detail.includes('duplicated span(s)')).toBeTruthy();
});

test('a second copied span between the same two files joins the finding they already have', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-clones-'));

	mkdirSync(join(dir, 'src'), { recursive: true });
	writeFileSync(join(dir, 'src/first.ts'), `export const one = ({ records }: { records: any[] }) => {${bigBody}};\nexport const two = ({ records }: { records: any[] }) => {${otherBody}};\n`);
	writeFileSync(join(dir, 'src/second.ts'), `export const three = ({ records }: { records: any[] }) => {${bigBody}};\nexport const four = ({ records }: { records: any[] }) => {${otherBody}};\n`);

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const clones = findings.filter((finding) => finding.rule === 'clone');

	// two copied spans between one pair of files is one thing to fix, not two
	expect(clones.map((finding) => finding.siteKey)).toStrictEqual(['clone:src/first.ts|src/second.ts']);
	// every span is still carried, one files entry per side
	expect(clones[0]?.files.length).toBe(4);
	expect(clones[0]?.detail.startsWith('2 duplicated span(s)')).toBeTruthy();
});

test('the clone floor comes from the rule settings, so a repo can raise it', async () => {
	const dir = setupClonedRepo();

	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({ scripts: { check: 'true', testUnit: 'true', testCoverage: false }, standardsChecks: { clone: { settings: { minTokens: 5000 } } } }),
	);

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

	// no span in the fixture reaches 5000 tokens
	expect(findings.some((finding) => finding.rule === 'clone')).toBeFalsy();
});

test('a javascript file is tokenized as javascript, so tier 1 covers a repo with no typescript in it', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-clones-'));

	mkdirSync(join(dir, 'src'), { recursive: true });
	// No type annotations anywhere — the tokenizer must be handed 'javascript'
	// for these to parse at all, which is what makes the clone visible.
	writeFileSync(join(dir, 'src/alpha.js'), `export const alpha = ({ records }) => {${bigBody}};\n`);
	writeFileSync(join(dir, 'src/beta.js'), `export const beta = ({ records }) => {${bigBody}};\n`);

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const clones = findings.filter((finding) => finding.rule === 'clone');

	expect(clones.map((finding) => finding.siteKey)).toStrictEqual(['clone:src/alpha.js|src/beta.js']);
});

test('a listed file that cannot be read is skipped, never fatal', async () => {
	const dir = setupClonedRepo();

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

	// the run completes and still reports the readable files
	expect(findings.length > 0).toBeTruthy();
	// an unreadable file contributes nothing:\n${JSON.stringify(findings,
	// undefined, 1)}
	expect(findings.some((finding) => finding.files.some((file) => file.path === 'src/broken.ts'))).toBeFalsy();
});
