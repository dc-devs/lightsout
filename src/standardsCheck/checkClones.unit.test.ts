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
	// a copied span is a rule violation the refactor pipeline acts on, never an advisory
	expect(clones.every((finding) => finding.severity === 'finding')).toBeTruthy();
	// the site key names the duplicated span — file and start line:\n${JSON.stringify(clones, undefined, 1)}
	expect(clones.every((finding) => /^clone:src\/[ab]\/(alpha|beta)\.ts:\d+$/.test(finding.siteKey))).toBeTruthy();
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
