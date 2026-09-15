import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { FindingSeverity } from '#src/contracts/index.ts';
import { lintPlanStructure } from '#src/plan/lint/index.ts';
import { emptyDecisionsRecord } from '#tests/helpers/emptyDecisionsRecord.ts';
import { overviewBody, phaseBody } from '#tests/helpers/phasePlan.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const setup = ({ siblingInput = false } = {}) => {
	const cwd = setupConsumerRepo();
	const directory = join(cwd, '.lightsout', 'plans', 'demo');
	mkdirSync(directory, { recursive: true });
	const rows = [
		{ number: 1, file: 'phase9-root.md', creates: ['src/root.ts'], created: 1, touched: 1, scripts: ['check:root'] },
		{ number: 2, file: 'phase2-report.md', creates: ['src/report.ts'], created: 1, touched: 1, scripts: ['check:report'] },
		{ number: 3, file: 'phase1-child.md', created: 0, touched: 1 },
	];
	const bodies = [
		overviewBody({ rows }),
		phaseBody({ create: ['src/root.ts'], commands: ['pnpm check:root'], note: 'Adds the `check:root` script for root validation.' }),
		phaseBody({ create: ['src/report.ts'], commands: ['pnpm check:report'], note: 'Adds the `check:report` script for report validation.' }),
		phaseBody({ earlierModify: [siblingInput ? 'src/report.ts' : 'src/root.ts'], commands: [siblingInput ? 'pnpm check:report' : 'pnpm check:root'] }),
	];
	const names = ['overview.md', ...rows.map(({ file }) => file)];
	const planPaths = names.map((name, index) => {
		const path = join(directory, name);
		writeFileSync(path, bodies[index]);
		return path;
	});
	const canonicalPhases = rows.map(({ file }, index) => ({ file, id: String(index), prerequisiteIds: index === 2 ? ['0'] : [] }));
	return { cwd, planPaths, canonicalPhases, decisions: emptyDecisionsRecord() };
};

describe('lintPlanStructure', () => {
	test('accepts declared ancestor paths and scripts with canonical order independent of filename numbers', async () => {
		const input = setup();

		const findings = await lintPlanStructure(input);

		expect(findings).toEqual([]);
	});

	test('rejects an earlier sibling as a supplier of paths or verification scripts', async () => {
		const input = setup({ siblingInput: true });

		const findings = await lintPlanStructure(input);

		expect(findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					phase: 'phase1-child.md',
					severity: FindingSeverity.Blocking,
					location: 'phase1-child.md → src/report.ts',
					issue: 'no earlier phase creates this path',
				}),
				expect.objectContaining({ phase: 'phase1-child.md', severity: FindingSeverity.Blocking, issue: expect.stringContaining('check:report') }),
			]),
		);
	});

	test.each([{ id: '' }, { id: '0' }, { prerequisiteIds: ['2'] }, { prerequisiteIds: ['missing'] }, { file: 'phase9-root.md' }])(
		'rejects duplicate, missing or forward canonical identities %j',
		async (mutation) => {
			const input = setup();
			input.canonicalPhases[1] = { ...input.canonicalPhases[1], ...mutation };

			const lint = lintPlanStructure(input);

			await expect(lint).rejects.toThrow(/Canonical phase/);
		},
	);
});
