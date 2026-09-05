import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { durablePlanFiles } from '#src/plan/publish/durablePlanFiles.ts';

// No mocks: the subject reads a plan folder off disk, so the arrangement is a
// real temporary folder holding exactly the files each case is about.
const setupPlanFolder = ({ files }: { files: Record<string, string> }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-durable-plan-files-'));
	const dir = join(cwd, '.lightsout', 'plans', 'lo-54-portable-plan');

	mkdirSync(dir, { recursive: true });

	for (const [name, text] of Object.entries(files)) {
		writeFileSync(join(dir, name), text);
	}

	return { cwd, dir, name: 'lo-54-portable-plan' };
};

/** Run state a plan folder always holds and no publish ever carries. */
const runState = {
	'facts.json': '{}',
	'grade-history.jsonl': '{}\n',
	'draft-agent.jsonl': '{}\n',
	'manifest.json': '{}',
};

describe('durablePlanFiles', () => {
	test('a single plan travels as plan.md first, then only the records the folder actually holds', async () => {
		const { cwd, dir, name } = setupPlanFolder({ files: { 'plan.md': '# plan', 'decisions.json': '[]', ...runState } });

		expect(await durablePlanFiles({ cwd, name })).toStrictEqual({
			files: [
				{ name: 'plan.md', path: join(dir, 'plan.md') },
				{ name: 'decisions.json', path: join(dir, 'decisions.json') },
			],
		});
	});

	test('every record the folder holds travels, in the order the durable list names them', async () => {
		const { cwd, dir, name } = setupPlanFolder({
			files: { 'plan.md': '# plan', 'grade.json': '{}', 'decisions.json': '[]', 'brainstorm-notes.md': '# notes' },
		});

		expect((await durablePlanFiles({ cwd, name })).files).toStrictEqual([
			{ name: 'plan.md', path: join(dir, 'plan.md') },
			{ name: 'brainstorm-notes.md', path: join(dir, 'brainstorm-notes.md') },
			{ name: 'decisions.json', path: join(dir, 'decisions.json') },
			{ name: 'grade.json', path: join(dir, 'grade.json') },
		]);
	});

	test('a phased plan travels as overview.md, then every phase file in reading order, then the records', async () => {
		const { cwd, dir, name } = setupPlanFolder({
			files: {
				'overview.md': '# overview',
				'phase2-config.md': '# two',
				'phase1-seam.md': '# one',
				'grade.json': '{}',
				...runState,
			},
		});

		expect((await durablePlanFiles({ cwd, name })).files).toStrictEqual([
			{ name: 'overview.md', path: join(dir, 'overview.md') },
			{ name: 'phase1-seam.md', path: join(dir, 'phase1-seam.md') },
			{ name: 'phase2-config.md', path: join(dir, 'phase2-config.md') },
			{ name: 'grade.json', path: join(dir, 'grade.json') },
		]);
	});

	test('a folder with no deliverable refuses by name, because the deliverable is the one file nothing can be implemented without', async () => {
		const { cwd, name } = setupPlanFolder({ files: { 'brainstorm-notes.md': '# notes', ...runState } });

		const set = await durablePlanFiles({ cwd, name });

		expect(set.files).toStrictEqual([]);
		expect(set.error ?? '').toMatch(/^nothing to publish for 'lo-54-portable-plan': no plan found for 'lo-54-portable-plan'/);
	});

	test('phase files without an overview refuse instead of publishing a folder a fresh clone cannot run', async () => {
		const { cwd, name } = setupPlanFolder({ files: { 'phase1-seam.md': '# one', 'decisions.json': '[]' } });

		expect(await durablePlanFiles({ cwd, name })).toStrictEqual({
			files: [],
			error: "nothing to publish for 'lo-54-portable-plan': phase files need an overview.md so the restored folder is a runnable phased plan",
		});
	});

	test('run state is never in the list — a transcript, the verified facts and the grade history all stay on the machine', async () => {
		const { cwd, name } = setupPlanFolder({ files: { 'plan.md': '# plan', ...runState } });

		expect((await durablePlanFiles({ cwd, name })).files.map((file) => file.name)).toStrictEqual(['plan.md']);
	});
});
