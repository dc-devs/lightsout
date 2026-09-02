import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolvePlanDeliverable } from '#src/plan/common/utils/resolvePlanDeliverable.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

/**
 * A repo root whose plan folder holds exactly the named files. Pass no files at
 * all and the folder itself is never created, which is the case a fresh clone
 * hits: the plan was published to its ticket and nothing is on disk yet.
 */
const setupPlanFolder = async ({ files = {} }: { files?: Record<string, string> } = {}) => {
	const cwd = await freshCwd();
	const name = 'lo-54-a-finished-plan';
	const dir = join(cwd, '.lightsout', 'plans', name);
	const entries = Object.entries(files);

	if (entries.length > 0) {
		await mkdir(dir, { recursive: true });

		for (const [fileName, text] of entries) {
			await writeFile(join(dir, fileName), text, 'utf8');
		}
	}

	return { cwd, name, dir };
};

describe('resolvePlanDeliverable', () => {
	test('resolves a single plan to plan.md alone, with no overview', async () => {
		const { cwd, name, dir } = await setupPlanFolder({
			files: { 'plan.md': '# The single plan\n', 'notes.md': 'working notes\n' },
		});

		const resolved = await resolvePlanDeliverable({ cwd, name });

		expect(resolved).toStrictEqual({
			files: [{ path: join(dir, 'plan.md'), text: '# The single plan\n' }],
			overviewPath: undefined,
			overviewText: undefined,
		});
	});

	test('takes plan.md exclusively when it sits beside phase files', async () => {
		const { cwd, name, dir } = await setupPlanFolder({
			files: {
				'plan.md': '# The single plan\n',
				'overview.md': '# The overview\n',
				'phase1-first.md': '# Phase one\n',
			},
		});

		const resolved = await resolvePlanDeliverable({ cwd, name });

		expect(resolved).toStrictEqual({
			files: [{ path: join(dir, 'plan.md'), text: '# The single plan\n' }],
			overviewPath: undefined,
			overviewText: undefined,
		});
	});

	test('resolves a phased plan to every phase file, sorted, with the overview held apart as context', async () => {
		const { cwd, name, dir } = await setupPlanFolder({
			files: {
				'phase2-second.md': '# Phase two\n',
				'overview.md': '# The overview\n',
				'phase1-first.md': '# Phase one\n',
			},
		});

		const resolved = await resolvePlanDeliverable({ cwd, name });

		expect(resolved).toStrictEqual({
			overviewPath: join(dir, 'overview.md'),
			overviewText: '# The overview\n',
			files: [
				{ path: join(dir, 'phase1-first.md'), text: '# Phase one\n' },
				{ path: join(dir, 'phase2-second.md'), text: '# Phase two\n' },
			],
		});
	});

	test('resolves phase files with no overview beside them', async () => {
		const { cwd, name, dir } = await setupPlanFolder({ files: { 'phase1-first.md': '# Phase one\n' } });

		const resolved = await resolvePlanDeliverable({ cwd, name });

		expect(resolved).toStrictEqual({
			overviewPath: undefined,
			overviewText: undefined,
			files: [{ path: join(dir, 'phase1-first.md'), text: '# Phase one\n' }],
		});
	});

	test('ignores the working files a plan folder also holds, so none is graded as a plan', async () => {
		const { cwd, name, dir } = await setupPlanFolder({
			files: {
				'overview.md': '# The overview\n',
				'phase1-first.md': '# Phase one\n',
				'notes.md': 'working notes\n',
				'facts.json': '{}',
				'decisions.json': '{}',
				'grade-stream.jsonl': '{}\n',
				'phases.md': '# not a numbered phase\n',
			},
		});

		const resolved = await resolvePlanDeliverable({ cwd, name });

		expect(resolved.files).toStrictEqual([{ path: join(dir, 'phase1-first.md'), text: '# Phase one\n' }]);
	});

	test('a plan folder holding no plan file resolves to no files and an error naming both paths it expected', async () => {
		const { cwd, name, dir } = await setupPlanFolder({ files: { 'facts.json': '{}', 'notes.md': 'notes\n' } });

		const resolved = await resolvePlanDeliverable({ cwd, name });

		expect(resolved.files).toStrictEqual([]);
		expect(resolved.error).toEqual(expect.stringContaining(`no plan found for '${name}' — expected ${join(dir, 'plan.md')} or ${dir}/phase<N>-<slug>.md`));
	});

	test('a missing plan folder is an error, not a throw', async () => {
		const { cwd, name, dir } = await setupPlanFolder();

		const resolved = await resolvePlanDeliverable({ cwd, name });

		expect(resolved.files).toStrictEqual([]);
		expect(resolved.error).toEqual(expect.stringContaining(join(dir, 'plan.md')));
	});

	test('the error says this pass asked no tracker and names the publish command that puts a plan on the ticket', async () => {
		const { cwd, name } = await setupPlanFolder();

		const resolved = await resolvePlanDeliverable({ cwd, name });

		expect(resolved.error).toEqual(expect.stringContaining('asked no tracker'));
		expect(resolved.error).toEqual(
			expect.stringContaining(`\`lightsout implement\` fetches a plan published to its ticket, or run \`lightsout plan publish --name ${name}\``),
		);
	});
});
