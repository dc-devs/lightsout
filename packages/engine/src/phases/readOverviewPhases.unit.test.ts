import { expect, test } from '@jest/globals';
import { readOverviewPhases } from '#src/phases/index.ts';

test('readOverviewPhases: takes the File column in written order, so phase10 stays after phase2', () => {
	const rows = Array.from({ length: 11 }, (_, index) => `| ${index + 1} | \`phase${index + 1}-slug.md\` | scope ${index + 1} |`).join('\n');
	const overviewContent = `# Feature — Overview\n\n## Phases\n\n| # | File | Scope |\n|---|------|-------|\n${rows}\n`;

	const phases = readOverviewPhases({ overviewContent });

	expect(phases[0]).toBe('phase1-slug.md');
	expect(phases[1]).toBe('phase2-slug.md');
	// written order, not filename order — phase10 is last because the table says so
	expect(phases[10]).toBe('phase11-slug.md');
	expect(phases.length).toBe(11);
});

test('readOverviewPhases: content with no Phases section yields nothing', () => {
	expect(readOverviewPhases({ overviewContent: '# Plan\n\n## Files to Create\n\n- `src/a.ts`\n' })).toStrictEqual([]);
});

test('readOverviewPhases: the header row, the divider, and a row without a code span are all skipped', () => {
	const overviewContent = '## Phases\n\n| # | File | Scope |\n|---|------|-------|\n| 1 | phase1.md | no backticks |\n| 2 | `phase2.md` | real |\n';

	expect(readOverviewPhases({ overviewContent })).toStrictEqual(['phase2.md']);
});

test('readOverviewPhases: rows under the next ## heading are not phases', () => {
	const overviewContent = '## Phases\n\n| 1 | `phase1.md` | first |\n\n## Cross-Phase Dependencies\n\n| 2 | `phase2.md` | not a phase row |\n';

	expect(readOverviewPhases({ overviewContent })).toStrictEqual(['phase1.md']);
});

test('readOverviewPhases: a ragged row with no File column is skipped, not read as a phase', () => {
	// a hand-edited table can lose a cell; the reader must not treat the row's
	// only cell as the File column, nor stop reading the rows after it
	const overviewContent = '## Phases\n\n| # | File | Scope |\n|---|------|-------|\n| `phase-with-no-second-cell.md`\n| 2 | `phase2.md` | real |\n';

	expect(readOverviewPhases({ overviewContent })).toStrictEqual(['phase2.md']);
});
