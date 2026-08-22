import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { StructuralCheck } from '#src/contracts/index.ts';
import { checkPlanPaths } from '#src/plan/lint/checkPlanPaths.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

/** A repo holding one real source file, and a parsed plan built from the given sections. */
const setup = ({ sections }: { sections: string }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-plan-paths-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/index.js'), 'export const one = 1;\n');

	const planPath = join(cwd, 'demo.md');
	const plan = parsePlan({ content: `# Plan\n\n${sections}`, base: 'demo.md' });

	return { cwd, planPath, plan };
};

/** The check as the lint calls it: a single plan with nothing supplied by a predecessor, unless the test says otherwise. */
const check = ({
	cwd,
	planPath,
	plan,
	provided = [],
	phased = false,
}: {
	cwd: string;
	planPath: string;
	plan: ReturnType<typeof parsePlan>;
	provided?: string[];
	phased?: boolean;
}) => checkPlanPaths({ plan, cwd, planPath, phase: 'demo.md', provided: new Set(provided), phased });

describe('checkPlanPaths', () => {
	test('a missing Files to Modify path is flagged', async () => {
		const { cwd, planPath, plan } = setup({ sections: '## Files to Modify\n\n### `src/does-not-exist.ts`\n\nChange something.\n' });

		const findings = await check({ cwd, planPath, plan });

		expect(findings.some((finding) => finding.check === StructuralCheck.PathExists && finding.issue.includes('src/does-not-exist.ts'))).toBe(true);
	});

	test('a missing Patterns to Mirror path is flagged with its plan-relative location and fix', async () => {
		const { cwd, planPath, plan } = setup({ sections: '## Patterns to Mirror\n\n- `src/gone.ts` — mirror its single-export shape.\n' });

		const findings = await check({ cwd, planPath, plan });

		// a mirror target is stated as existing code — a missing one is the same
		// defect as a missing modify path
		expect(findings).toStrictEqual([
			{
				check: StructuralCheck.PathExists,
				severity: 'blocking',
				phase: 'demo.md',
				issue: 'referenced path does not exist: src/gone.ts',
				location: 'demo.md → src/gone.ts',
				fix: 'correct the path or move it under Files to Create if it does not exist yet',
			},
		]);
	});

	test('a Files to Create path that already exists is flagged with a location and a fix that moves it', async () => {
		const { cwd, planPath, plan } = setup({ sections: '## Files to Create\n\n### `src/index.js`\n\nBut this already exists.\n' });

		const findings = await check({ cwd, planPath, plan });

		expect(findings).toStrictEqual([
			{
				check: StructuralCheck.PathExists,
				severity: 'blocking',
				phase: 'demo.md',
				issue: 'Files to Create path already exists: src/index.js',
				location: 'demo.md → src/index.js',
				fix: 'move it to Files to Modify, or choose a new path',
			},
		]);
	});

	test('paths that hold their stated ground produce no findings', async () => {
		const { cwd, planPath, plan } = setup({
			sections: '## Files to Create\n\n### `src/new-thing.ts`\n\nNew module.\n\n## Files to Modify\n\n### `src/index.js`\n\nRe-export it.\n',
		});

		await expect(check({ cwd, planPath, plan })).resolves.toStrictEqual([]);
	});

	test('a modify path an earlier phase creates is not a broken reference', async () => {
		const { cwd, planPath, plan } = setup({ sections: '## Files to Modify\n\n### `src/from-phase-one.ts`\n\nExtend it.\n' });

		// the file is absent from disk today and present in the finished repo —
		// judging it against today's tree would flag every phase that builds on its
		// predecessor
		await expect(check({ cwd, planPath, plan, provided: ['src/from-phase-one.ts'], phased: true })).resolves.toStrictEqual([]);
	});

	test('creating a path an earlier phase already creates is flagged with the heading that owns it', async () => {
		const { cwd, planPath, plan } = setup({ sections: '## Files to Create\n\n### `src/from-phase-one.ts`\n\nCreate it again.\n' });

		const findings = await check({ cwd, planPath, plan, provided: ['src/from-phase-one.ts'], phased: true });

		expect(findings[0]?.issue).toBe('an earlier phase already creates this path: src/from-phase-one.ts');
		expect(findings[0]?.fix).toBe('list it under `## Files to Modify from Earlier Phases`');
	});

	test('a move destination is new ground, exactly as a created file is', async () => {
		const { cwd, planPath, plan } = setup({ sections: '## Files to Move\n\n### `src/index.js` → `src/index.js`\n\nOnto itself, which already exists.\n' });

		const findings = await check({ cwd, planPath, plan });

		expect(findings.some((finding) => finding.issue === 'Files to Move destination already exists: src/index.js')).toBe(true);
	});

	test('an earlier-phase modify naming a file that exists today is flagged back to Files to Modify', async () => {
		const { cwd, planPath, plan } = setup({ sections: '## Files to Modify from Earlier Phases\n\n### `src/index.js`\n\nBut it is already here.\n' });

		const findings = await check({ cwd, planPath, plan, phased: true });

		expect(findings).toStrictEqual([
			{
				check: StructuralCheck.PathExists,
				severity: 'blocking',
				phase: 'demo.md',
				issue: 'Files to Modify from Earlier Phases path already exists: src/index.js',
				location: 'demo.md → src/index.js',
				fix: 'this file exists today — list it under `## Files to Modify`',
			},
		]);
	});

	test('a single plan can only delete a file that is there', async () => {
		const { cwd, planPath, plan } = setup({ sections: '## Files to Delete\n\n### `src/never-existed.ts`\n\nGone already.\n' });

		const findings = await check({ cwd, planPath, plan });

		expect(findings.some((finding) => finding.issue === 'referenced path does not exist: src/never-existed.ts')).toBe(true);
	});

	test('a phased plan leaves its deletes to the cross-phase pass rather than judging them against today', async () => {
		const { cwd, planPath, plan } = setup({ sections: '## Files to Delete\n\n### `src/from-phase-one.ts`\n\nA file phase one wrote.\n' });

		// whether the file is there depends on which phases ran first, which is a
		// question only the cross-phase pass can answer
		await expect(check({ cwd, planPath, plan, phased: true })).resolves.toStrictEqual([]);
	});

	test('a well-formed move is silent: the source is there to move and the destination is free ground', async () => {
		const { cwd, planPath, plan } = setup({ sections: '## Files to Move\n\n### `src/index.js` → `src/moved.ts`\n\nRelocate the entry point.\n' });

		await expect(check({ cwd, planPath, plan })).resolves.toStrictEqual([]);
	});
});
