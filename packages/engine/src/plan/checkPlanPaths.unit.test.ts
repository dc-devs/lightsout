import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { StructuralCheck } from '#src/contracts/index.ts';
import { checkPlanPaths } from '#src/plan/checkPlanPaths.ts';
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

describe('checkPlanPaths', () => {
	test('a missing Files to Modify path is flagged', async () => {
		const { cwd, planPath, plan } = setup({ sections: '## Files to Modify\n\n### `src/does-not-exist.ts`\n\nChange something.\n' });

		const findings = await checkPlanPaths({ plan, cwd, planPath });

		expect(findings.some((finding) => finding.check === StructuralCheck.PathExists && finding.issue.includes('src/does-not-exist.ts'))).toBe(true);
	});

	test('a missing Patterns to Mirror path is flagged with its plan-relative location and fix', async () => {
		const { cwd, planPath, plan } = setup({ sections: '## Patterns to Mirror\n\n- `src/gone.ts` — mirror its single-export shape.\n' });

		const findings = await checkPlanPaths({ plan, cwd, planPath });

		// a mirror target is stated as existing code — a missing one is the same
		// defect as a missing modify path
		expect(findings).toStrictEqual([
			{
				check: StructuralCheck.PathExists,
				issue: 'referenced path does not exist: src/gone.ts',
				location: 'demo.md → src/gone.ts',
				fix: 'correct the path or move it under Files to Create if it does not exist yet',
			},
		]);
	});

	test('a Files to Create path that already exists is flagged with a location and a fix that moves it', async () => {
		const { cwd, planPath, plan } = setup({ sections: '## Files to Create\n\n### `src/index.js`\n\nBut this already exists.\n' });

		const findings = await checkPlanPaths({ plan, cwd, planPath });

		expect(findings).toStrictEqual([
			{
				check: StructuralCheck.PathExists,
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

		await expect(checkPlanPaths({ plan, cwd, planPath })).resolves.toStrictEqual([]);
	});
});
