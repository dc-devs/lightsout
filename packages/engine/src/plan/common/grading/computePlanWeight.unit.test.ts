import { describe, expect, test } from '@jest/globals';
import { computePlanWeight } from '#src/plan/common/grading/computePlanWeight.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

/** The thresholds every case is weighed against unless it says otherwise — the shipped defaults. */
const thresholds = { createdFiles: 3, packages: 1 };

/** One `## Files to …` section, or nothing at all when the case names no path for it. */
const heading = ({ title, paths }: { title: string; paths: string[] }) =>
	paths.length === 0 ? '' : `## ${title}\n\n${paths.map((path) => `### \`${path}\`\n`).join('\n')}\n`;

/** A plan file creating `creates`, modifying `modifies`, and mirroring one file unless the case drops it. */
const weigh = ({ creates, modifies = [], mirror = true }: { creates: string[]; modifies?: string[]; mirror?: boolean }) => {
	const mirrors = mirror ? '## Patterns to Mirror\n\n- `packages/engine/src/old.ts` — follow it.\n' : '';
	const content = `# Plan\n\n${heading({ title: 'Files to Create', paths: creates })}${heading({ title: 'Files to Modify', paths: modifies })}${mirrors}`;

	return computePlanWeight({ plan: parsePlan({ content, base: 'plan.md' }), phase: 'plan.md', packagesDir: 'packages', thresholds });
};

describe('computePlanWeight', () => {
	test('a file inside every threshold with a pattern to mirror is light, and says why by saying nothing', () => {
		const weight = weigh({ creates: ['packages/engine/src/a.ts', 'packages/engine/src/b.ts'] });

		expect(weight).toStrictEqual({ phase: 'plan.md', weight: 'light', reasons: [] });
	});

	test('creating more source files than the threshold makes it heavy, and the reason names both numbers', () => {
		const weight = weigh({ creates: ['a', 'b', 'c', 'd'].map((name) => `packages/engine/src/${name}.ts`) });

		expect(weight.weight).toBe('heavy');
		expect(weight.reasons).toStrictEqual(['creates 4 source files, above 3']);
	});

	test('touching a second package makes it heavy whatever its counts', () => {
		const weight = weigh({ creates: ['packages/engine/src/a.ts'], modifies: ['packages/web-app/src/b.ts'] });

		expect(weight.weight).toBe('heavy');
		expect(weight.reasons).toStrictEqual(['touches 2 packages, above 1']);
	});

	test('a path under no package is the repository root, which is one package like any other', () => {
		const weight = weigh({ creates: ['scripts/a.mjs'], modifies: ['scripts/b.mjs'] });

		expect(weight.weight).toBe('light');
	});

	test('a file with nothing to mirror is always heavy — that is where a reader earns its cost', () => {
		const weight = weigh({ creates: ['packages/engine/src/a.ts'], mirror: false });

		expect(weight.reasons).toStrictEqual(['names no pattern to mirror']);
	});

	test('test files and barrels are outside the created count, exactly as the size checks have them', () => {
		const creates = ['packages/engine/src/a.ts', 'packages/engine/src/a.unit.test.ts', 'packages/engine/src/index.ts', 'packages/engine/src/b.d.ts'];

		expect(weigh({ creates }).weight).toBe('light');
	});
});
