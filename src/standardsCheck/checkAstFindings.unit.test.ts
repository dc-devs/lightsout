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
	// the site key is the shared body hash, truncated — one key per duplicate group
	expect(duplicates[0]?.siteKey).toMatch(/^ast:[0-9a-f]{12}$/);
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
	const sizes = findings.filter((finding) => finding.rule === 'size');

	const report = sizes.find((finding) => finding.siteKey === 'size:function:sizes.ts:buildReport');
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
	expect(sizes.some((finding) => finding.siteKey.includes('useReportData'))).toBeFalsy();

	const panel = sizes.find((finding) => finding.siteKey === 'size:component:Panel.tsx:Panel');
	// a capitalized .tsx function is a component:\n${JSON.stringify(sizes,
	// undefined, 1)}
	expect(panel?.detail.includes('cap ~200')).toBeTruthy();
	// the .tsx file itself stays under its larger file cap
	expect(sizes.some((finding) => finding.siteKey === 'size:file:Panel.tsx')).toBeFalsy();

	// the enclosing named function is measured
	expect(sizes.some((finding) => finding.siteKey === 'size:function:callbacks.ts:runAll')).toBeTruthy();
	// callbacks inherit their parent's budget:\n${JSON.stringify(sizes, undefined,
	// 1)}
	expect(sizes.some((finding) => finding.siteKey.includes('(anonymous)'))).toBeFalsy();
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
	const named = findings.filter((finding) => finding.rule === 'size').map((finding) => finding.detail);

	expect(named.some((detail) => detail.includes("'declaredHelper'"))).toBe(true);
	expect(named.some((detail) => detail.includes("'doTheWork'"))).toBe(true);
	// never the placeholder an unnamed node would get
	expect(named.some((detail) => detail.includes('(anonymous)'))).toBe(false);
});
