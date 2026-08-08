import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { runStandardsCheck } from '@/standardsCheck';

const setupRepo = (files: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-ast-'));

	for (const [name, content] of Object.entries(files)) {
		writeFileSync(join(dir, name), content);
	}

	// The AST tier borrows the consumer's TypeScript — hand the fixture ours,
	// or runStandardsCheck degrades the ast-duplicate detector to a skip.
	mkdirSync(join(dir, 'node_modules'), { recursive: true });
	symlinkSync(join(process.cwd(), 'node_modules/typescript'), join(dir, 'node_modules/typescript'), 'dir');

	return dir;
};

// Bodies must clear minBodyTokens (40) to be duplicate candidates — the
// padding statements exist purely to cross that floor.
const wrapper = ({ name, hook }: { name: string; hook: string }) => `
export const ${name} = ({ id }: { id: number }) => {
	const mutation = ${hook}();
	const first = mutation.a + mutation.b + mutation.c + mutation.d;
	const second = first + mutation.e + mutation.f + mutation.g + mutation.h;
	const third = second + mutation.i + mutation.j + mutation.k + mutation.l;

	return { id, mutation, first, second, third };
};
`;

test('ast-duplicate: wrappers binding DIFFERENT use* hooks are not duplicates; identical hooks still are', async () => {
	const dir = setupRepo({
		'github.ts': wrapper({ name: 'GitHubButton', hook: 'useCreateGitHubInstallation' }),
		'linear.ts': wrapper({ name: 'LinearButton', hook: 'useCreateLinearInstallation' }),
		// Same hook, only non-hook identifiers renamed — a genuine systematic-rename duplicate.
		'copyA.ts': wrapper({ name: 'AlphaButton', hook: 'useSharedThing' }).replace(/mutation/g, 'alpha'),
		'copyB.ts': wrapper({ name: 'BetaButton', hook: 'useSharedThing' }).replace(/mutation/g, 'beta'),
	});

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const duplicates = findings.filter((finding) => finding.rule === 'ast-duplicate');

	// expected exactly the same-hook pair flagged, got:
	// ${JSON.stringify(duplicates)}
	expect(duplicates.length).toBe(1);
	// only the pair calling the SAME hook is a duplicate — different hooks make
	// bodies distinct
	expect(duplicates[0]?.files.map((file) => file.path).sort()).toStrictEqual(['copyA.ts', 'copyB.ts']);
	// identical bodies are a rule violation the refactor pipeline acts on
	expect(duplicates[0]?.severity).toBe('finding');
	// the site key is the rule and the paths — a hash would re-mint the identity
	// on any edit, which is what the debt ledger and the gate cannot survive
	expect(duplicates[0]?.siteKey).toBe('ast-duplicate:copyA.ts|copyB.ts');
});

test('two duplicate groups over the same file pair are one finding — the identity is the paths, never the hash', async () => {
	const dir = setupRepo({
		// Two distinct bodies, each copied into both files: two hash groups over
		// one file set. A hash in the key would split them into two rows that
		// re-mint themselves on any edit.
		'alpha.ts': `${wrapper({ name: 'AlphaOne', hook: 'useThingOne' })}${wrapper({ name: 'AlphaTwo', hook: 'useThingTwo' })}`,
		'beta.ts': `${wrapper({ name: 'BetaOne', hook: 'useThingOne' })}${wrapper({ name: 'BetaTwo', hook: 'useThingTwo' })}`,
	});

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const duplicates = findings.filter((finding) => finding.rule === 'ast-duplicate');

	// one row in the work-list, keyed by the paths alone
	expect(duplicates.map((finding) => finding.siteKey)).toStrictEqual(['ast-duplicate:alpha.ts|beta.ts']);
	// every duplicated body still carries its own span
	expect(duplicates[0]?.files.map((file) => file.path).sort()).toStrictEqual(['alpha.ts', 'alpha.ts', 'beta.ts', 'beta.ts']);
	// and both groups are named, so the merged row still says what to
	// open: ${duplicates[0]?.detail}
	expect(["'AlphaOne'", "'BetaOne'", "'AlphaTwo'", "'BetaTwo'"].every((name) => duplicates[0]?.detail.includes(name))).toBe(true);
});

// Statement padding that grows a function body to a chosen line count; the
// prefix keeps each body's identifiers distinct so the padding itself never
// reads as a duplicate.
const filler = ({ lines, prefix }: { lines: number; prefix: string }) =>
	Array.from({ length: lines }, (_, index) => `\tconst ${prefix}${index} = ${index} + ${index};`).join('\n');

test('the size audit measures each function against the cap its NAME earns, sparing callbacks', async () => {
	const dir = setupRepo({
		// ~103 lines, over the 80-line function cap — beside a same-sized use*
		// function that rides the 160-line hook cap and stays clear of it.
		'sizes.ts': `export const buildReport = () => {\n${filler({ lines: 100, prefix: 'report' })}\n\treturn 1;\n};\n\nexport const useReportData = () => {\n${filler({ lines: 101, prefix: 'hook' })}\n\treturn 2;\n};\n`,
		// A capitalized function in a .tsx file is a component: ~213 lines over
		// the 200-line component cap, while the file itself stays under the
		// larger .tsx file cap.
		'Panel.tsx': `export const Panel = () => {\n${filler({ lines: 210, prefix: 'panel' })}\n\treturn null;\n};\n`,
		// The inner callback is oversized too, but it inherits runAll's budget.
		'callbacks.ts': `export const runAll = () => {\n\t[1].forEach(() => {\n${filler({ lines: 90, prefix: 'step' })}\n\t});\n};\n`,
	});

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const sizes = findings.filter((finding) => finding.rule === 'size-function' || finding.rule === 'size-file');

	const report = sizes.find((finding) => finding.siteKey === 'size-function:sizes.ts');
	// an ordinary function carries the 80-line cap:\n${JSON.stringify(sizes,
	// undefined, 1)}
	expect(report?.detail.includes('cap ~80')).toBeTruthy();
	// size is a judgment call — orchestration functions are exempt, so it never
	// gates
	expect(report?.severity).toBe('advisory');
	// the finding spans the function that exceeded the cap:
	// ${JSON.stringify(report?.files)}
	expect((report?.files[0]?.endLine ?? 0) - (report?.files[0]?.startLine ?? 0) + 1 > 80).toBeTruthy();

	// a use* function of the same size rides the larger hook cap
	expect(sizes.some((finding) => finding.detail.includes('useReportData'))).toBeFalsy();

	const panel = sizes.find((finding) => finding.siteKey === 'size-function:Panel.tsx');
	// a capitalized .tsx function is a component:\n${JSON.stringify(sizes,
	// undefined, 1)}
	expect(panel?.detail.includes('cap ~200')).toBeTruthy();
	// the .tsx file itself stays under its larger file cap
	expect(sizes.some((finding) => finding.siteKey === 'size-file:Panel.tsx')).toBeFalsy();

	// the enclosing named function is measured
	expect(sizes.some((finding) => finding.detail.includes("'runAll'"))).toBeTruthy();
	// callbacks inherit their parent's budget:\n${JSON.stringify(sizes, undefined,
	// 1)}
	expect(sizes.some((finding) => finding.detail.includes('(anonymous)'))).toBeFalsy();
});

// Arrow functions carry no name of their own, so the reportable label comes
// from the variable they are assigned to. A `function` declaration and a class
// method DO carry one, and that is the name the finding must use.
test('size: a function declaration and a class method are reported under their own names', async () => {
	const body = `${'\tconst padding = 1;\n'.repeat(90)}`;
	const dir = setupRepo({
		'declared.ts': `export function declaredHelper() {\n${body}\treturn 1;\n}\n`,
		'method.ts': `export class Service {\n\tdoTheWork() {\n${body}\t\treturn 1;\n\t}\n}\n`,
	});

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const named = findings.filter((finding) => finding.rule === 'size-function').map((finding) => finding.detail);

	expect(named.some((detail) => detail.includes("'declaredHelper'"))).toBe(true);
	expect(named.some((detail) => detail.includes("'doTheWork'"))).toBe(true);
	// never the placeholder an unnamed node would get
	expect(named.some((detail) => detail.includes('(anonymous)'))).toBe(false);
});

test('several oversized functions in one file are one finding — the work is one file to open', async () => {
	const dir = setupRepo({
		'both.ts': `export const first = () => {\n${filler({ lines: 100, prefix: 'a' })}\n\treturn 1;\n};\n\nexport const second = () => {\n${filler({ lines: 100, prefix: 'b' })}\n\treturn 2;\n};\n`,
	});

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const sizes = findings.filter((finding) => finding.rule === 'size-function');

	// one file, one row in the work-list
	expect(sizes.map((finding) => finding.siteKey)).toStrictEqual(['size-function:both.ts']);
	// each oversized function keeps its own span
	expect(sizes[0]?.files.length).toBe(2);
	// and is named in the detail: ${sizes[0]?.detail}
	expect(sizes[0]?.detail.includes("'first'") && sizes[0].detail.includes("'second'")).toBeTruthy();
});

test('the size caps come from the rules own settings, so a repo can retune them', async () => {
	const dir = setupRepo({
		'small.ts': `export const small = () => {\n${filler({ lines: 20, prefix: 'x' })}\n\treturn 1;\n};\n`,
	});

	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({
			scripts: { check: 'true', testUnit: 'true', testCoverage: false },
			standardsChecks: { 'size-function': { settings: { function: 5 } }, 'size-file': { settings: { file: 5 } } },
		}),
	);

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

	// a 22-line function is over a 5-line cap
	expect(findings.find((finding) => finding.rule === 'size-function')?.detail.includes('cap ~5')).toBeTruthy();
	// and the 24-line file is over its own
	expect(findings.find((finding) => finding.rule === 'size-file')?.siteKey).toBe('size-file:small.ts');
});

// Two bodies of different statement counts normalize to different token
// streams, so one pair of files can carry two separate duplicate groups.
const pairFile = ({ first, second }: { first: string; second: string }) =>
	`export const ${first} = () => {\n${filler({ lines: 45, prefix: 'short' })}\n\treturn 1;\n};\n\nexport const ${second} = () => {\n${filler({ lines: 60, prefix: 'long' })}\n\treturn 2;\n};\n`;

test('two duplicate groups over the same pair of files are one finding, listing both', async () => {
	const dir = setupRepo({
		'alphaPair.ts': pairFile({ first: 'alphaShort', second: 'alphaLong' }),
		'betaPair.ts': pairFile({ first: 'betaShort', second: 'betaLong' }),
	});

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const duplicates = findings.filter((finding) => finding.rule === 'ast-duplicate');

	// a hash in the key would mint a second identity for the same two files, and
	// re-mint both on any edit
	expect(duplicates.map((finding) => finding.siteKey)).toStrictEqual(['ast-duplicate:alphaPair.ts|betaPair.ts']);
	// every site of both groups is still carried
	expect(duplicates[0]?.files.length).toBe(4);
	// and each group is named in the detail: ${duplicates[0]?.detail}
	expect(duplicates[0]?.detail.includes("'alphaShort', 'betaShort'")).toBe(true);
	expect(duplicates[0]?.detail.includes("'alphaLong', 'betaLong'")).toBe(true);
});

test('a barrel is exempt from the file-size cap — a re-export list is long by nature', async () => {
	const dir = setupRepo({
		'index.ts': `${'// a re-exported entry\n'.repeat(300)}export { bigThing } from './big';\n`,
		'big.ts': `export const bigThing = () => {\n${filler({ lines: 300, prefix: 'big' })}\n\treturn 1;\n};\n`,
	});

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const sizes = findings.filter((finding) => finding.rule === 'size-file');

	// the barrel is well over the 250-line cap too, and still exempt
	expect(sizes.map((finding) => finding.siteKey)).toStrictEqual(['size-file:big.ts']);
	expect(sizes[0]?.detail.includes('cap ~250')).toBe(true);
});

test('a listed file the ast tier cannot read is skipped, never fatal', async () => {
	const dir = setupRepo({ 'big.ts': `export const bigThing = () => {\n${filler({ lines: 300, prefix: 'big' })}\n\treturn 1;\n};\n` });

	// A dangling symlink is listed as a source file but can never be read.
	symlinkSync(join(dir, 'no-such-file.ts'), join(dir, 'broken.ts'));

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

	// the run completes and still measures the readable file
	expect(findings.some((finding) => finding.siteKey === 'size-file:big.ts')).toBe(true);
	// the unreadable one contributes nothing:\n${JSON.stringify(findings, undefined, 1)}
	expect(findings.some((finding) => finding.files.some((file) => file.path === 'broken.ts'))).toBe(false);
});

test('a function expression is reported under the variable it is assigned to', async () => {
	const dir = setupRepo({ 'compute.ts': `export const compute = function () {\n${filler({ lines: 90, prefix: 'step' })}\n\treturn 1;\n};\n` });

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const sizes = findings.filter((finding) => finding.rule === 'size-function');

	expect(sizes.map((finding) => finding.siteKey)).toStrictEqual(['size-function:compute.ts']);
	// an expression carries no name of its own, so the variable is the label
	expect(sizes[0]?.detail.includes("'compute'")).toBe(true);
	// never the placeholder an unnamed node would get
	expect(sizes[0]?.detail.includes('(anonymous)')).toBe(false);
});

test('a lowercase function in a .tsx file rides the function cap, not the component cap', async () => {
	const dir = setupRepo({ 'rows.tsx': `export const buildRows = () => {\n${filler({ lines: 90, prefix: 'row' })}\n\treturn null;\n};\n` });

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const sizes = findings.filter((finding) => finding.rule === 'size-function');

	// only a CAPITALIZED name in a .tsx file earns the 200-line component budget;
	// a ~93-line helper would clear that and be missed
	expect(sizes.map((finding) => finding.siteKey)).toStrictEqual(['size-function:rows.tsx']);
	expect(sizes[0]?.detail.includes('cap ~80')).toBe(true);
});

test('overload signatures and abstract methods have no body, and the implementation is still measured', async () => {
	const dir = setupRepo({
		'Runner.ts': `export abstract class Runner {\n\tabstract prepare(): void;\n\n\tdoWork(value: string): number;\n\tdoWork(value: number): number;\n\tdoWork(value: unknown): number {\n${filler({ lines: 90, prefix: 'step' })}\n\t\treturn 1;\n\t}\n}\n`,
	});

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const sizes = findings.filter((finding) => finding.rule === 'size-function');

	// a bodiless declaration has nothing to normalize — walking one must not take
	// the whole run down with it
	expect(sizes.map((finding) => finding.siteKey)).toStrictEqual(['size-function:Runner.ts']);
	// only the implementation has a span to measure
	expect(sizes[0]?.files.length).toBe(1);
	expect(sizes[0]?.detail.includes("'doWork'")).toBe(true);
});

test('the ast tier reports nothing when the repo has no resolvable typescript', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-ast-nots-'));

	writeFileSync(join(dir, 'huge.ts'), `export const huge = () => {\n${filler({ lines: 400, prefix: 'y' })}\n\treturn 1;\n};\n`);

	const { findings, notes } = await runStandardsCheck({ cwd: dir, persist: false });

	// no compiler, so the whole pass is skipped rather than half-reported
	expect(findings.some((finding) => finding.rule.startsWith('size-') || finding.rule === 'ast-duplicate')).toBeFalsy();
	// and the skip is said out loud:\n${notes.join('\n')}
	expect(notes.some((note) => note.includes('ast-findings') && note.includes('no typescript resolvable'))).toBeTruthy();
});
