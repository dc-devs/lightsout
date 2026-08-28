import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import { readRepoPathIndex } from '#src/plan/common/paths/readRepoPathIndex.ts';
import type { RepoPathIndex } from '#src/plan/common/types/RepoPathIndex.ts';
import { checkProsePaths } from '#src/plan/lint/checkProsePaths.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

/**
 * The files the repo really holds. `docs/` exists at the root AND nested under
 * `packages/web-app/src/features/`, which is the collision the anchored arm has
 * to fall through rather than report.
 */
const repoFiles = [
	'src/index.js',
	'src/deep/nested/thing.ts',
	'docs/notes.md',
	'packages/web-app/README.md',
	'packages/web-app/src/features/docs/panel.ts',
	'packages/web-app/src/PlanDetail/index.ts',
];

/** A repo holding `repoFiles`, and a plan whose Context prose is `prose` plus any extra sections. */
const setup = ({ prose, sections = '' }: { prose: string; sections?: string }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-prose-paths-'));

	for (const path of repoFiles) {
		mkdirSync(join(cwd, dirname(path)), { recursive: true });
		writeFileSync(join(cwd, path), 'export const one = 1;\n');
	}

	const planPath = join(cwd, 'demo.md');
	const plan = parsePlan({ content: `# Plan\n\n## Context\n\n${prose}\n\n${sections}`, base: 'demo.md' });

	return { cwd, planPath, plan };
};

/** The check as the lint calls it: the real repo index, and nothing planned unless the case says otherwise. */
const check = async ({
	cwd,
	planPath,
	plan,
	planned = [],
	index,
}: {
	cwd: string;
	planPath: string;
	plan: ReturnType<typeof parsePlan>;
	planned?: string[];
	index?: RepoPathIndex;
}) => checkProsePaths({ plan, cwd, planPath, phase: 'demo.md', planned: new Set(planned), index: index ?? (await readRepoPathIndex({ cwd })) });

/** The candidates a run reported missing, in the order it reported them. */
const missing = async (params: Parameters<typeof check>[0]) => (await check(params)).map((finding) => finding.issue);

describe('checkProsePaths', () => {
	test('an anchored prose path that is on disk is silent', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'It sits beside `src/deep/nested/thing.ts` today.' });

		await expect(check({ cwd, planPath, plan })).resolves.toStrictEqual([]);
	});

	test('an anchored prose path that is not on disk is one blocking finding naming the plan file and line', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'Read `src/gone.ts` first.' });

		const findings = await check({ cwd, planPath, plan });

		expect(findings).toStrictEqual([
			{
				check: StructuralCheck.ProsePathExists,
				severity: FindingSeverity.Blocking,
				phase: 'demo.md',
				issue: 'path named in prose does not exist: src/gone.ts',
				location: 'demo.md:5',
				fix: 'correct the path, or drop the backticks if the span is not naming a real file',
			},
		]);
	});

	test('a shorthand fragment that tail-matches a real source file is silent', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'Mirror `nested/thing.ts` for its shape.' });

		// the pool is the authority for anything that is not repo-rooted, and the
		// match is segment-aligned
		await expect(check({ cwd, planPath, plan })).resolves.toStrictEqual([]);
	});

	test('a fragment whose first segment is a top-level directory name but which really lives nested is not reported', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'The panel is `docs/panel.ts`.' });

		// `docs/` exists at the root and again under packages/web-app/src/features/,
		// so reporting on the failed stat alone would block a plan over a correct
		// fragment
		await expect(check({ cwd, planPath, plan })).resolves.toStrictEqual([]);
	});

	test('a shorthand fragment matching nothing at all is reported', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'See `nowhere/absent.ts` for the shape.' });

		await expect(missing({ cwd, planPath, plan })).resolves.toStrictEqual(['path named in prose does not exist: nowhere/absent.ts']);
	});

	test('a shorthand naming a markdown file is judged like any other, because the pool holds every file', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'Written up in `web-app/README.md`, unlike `web-app/CHANGELOG.md`.' });

		// a source-only pool would report the README as absent, which is a blocking
		// finding against a file that is on disk
		await expect(missing({ cwd, planPath, plan })).resolves.toStrictEqual(['path named in prose does not exist: web-app/CHANGELOG.md']);
	});

	test('an import specifier resolves through normalization to the file it names', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'Imports `#src/deep/nested/thing.ts` and `@/deep/nested/thing.ts`.' });

		await expect(check({ cwd, planPath, plan })).resolves.toStrictEqual([]);
	});

	test('a specifier that reduces to a bare filename has nothing left to place, and is skipped', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'The entry point is `#src/absent.ts` today.' });

		// stripping the alias leaves `absent.ts`, which any directory in the tree
		// could hold — the check refuses a name it cannot place rather than guessing
		await expect(check({ cwd, planPath, plan })).resolves.toStrictEqual([]);
	});

	test('a span holding whitespace is a command rather than a path, and is skipped', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'Run `node scripts/build.mjs` afterwards.' });

		await expect(check({ cwd, planPath, plan })).resolves.toStrictEqual([]);
	});

	test('a span holding a template literal names no fixed file, and is skipped', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'It writes `${workspaceDir}/grade.json` at the end.' });

		await expect(check({ cwd, planPath, plan })).resolves.toStrictEqual([]);
	});

	test('a span holding an angle-bracket placeholder names a family of files, and is skipped', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'Each run writes `.lightsout/runs/<id>/worklist.json`.' });

		await expect(check({ cwd, planPath, plan })).resolves.toStrictEqual([]);
	});

	test('a URL and an absolute filesystem path both name something outside the repo, and are skipped', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'Cited at `https://github.com/o/r/blob/main/x.ts`, cached at `/tmp/scratch/out.json`.' });

		// neither can ever tail-match a repo-relative entry, so judging one would
		// block a plan over a correctly-written citation
		await expect(check({ cwd, planPath, plan })).resolves.toStrictEqual([]);
	});

	test('a leading ellipsis is stripped and the tail resolved, while an ellipsis left mid-path is skipped', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'Both `…/nested/thing.ts` and `src/…/thing.ts` name the same file.' });

		// a leading elision leaves exactly the tail the shorthand match resolves; a
		// mid-path one leaves nothing to match, so it is refused rather than guessed
		await expect(check({ cwd, planPath, plan })).resolves.toStrictEqual([]);
	});

	test('an index that came back empty yields no findings at all', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'Read `src/gone.ts` and `nowhere/absent.ts`.' });

		const findings = await check({ cwd, planPath, plan, index: { topLevelDirs: new Set(), files: [] } });

		// an empty pool means the walk failed, not that nothing exists — judging
		// against it would make every backticked path a finding the repair loop can
		// never clear
		expect(findings).toStrictEqual([]);
	});

	test('a path the plan lists under Files to Create is left to checkPlanPaths', async () => {
		const { cwd, planPath, plan } = setup({
			prose: 'The new module is `src/created/newThing.ts`.',
			sections: '## Files to Create\n\n### `src/created/newThing.ts`\n\nA new module.\n',
		});

		// one wrong path must never produce two findings from two checks
		await expect(check({ cwd, planPath, plan })).resolves.toStrictEqual([]);
	});

	test('a path another file in the deliverable creates is not reported', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'Phase one writes `src/from-phase-one.ts`.' });

		// a path phase 6 creates is a real file however early it is mentioned, so
		// phase ordering is not this check's business
		await expect(check({ cwd, planPath, plan, planned: ['src/from-phase-one.ts'] })).resolves.toStrictEqual([]);
	});

	test('a created file quoted by its import specifier is subtracted by its tail, not by an exact string', async () => {
		const { cwd, planPath, plan } = setup({
			prose: 'Imports `#src/plan/lint/checkProsePaths.ts`.',
			sections: '## Files to Create\n\n### `packages/engine/src/plan/lint/checkProsePaths.ts`\n\nThe check.\n',
		});

		// exact-string subtraction reports every file a plan creates and then
		// references by import — the specifier matches the created path by no exact
		// string and does not exist on disk yet
		await expect(check({ cwd, planPath, plan })).resolves.toStrictEqual([]);
	});

	test('a glob is a search pattern rather than a claim that a file exists', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'Searched `packages/**/*.ts` for the name.' });

		// Prior Art records its searches this way, and stat-ing one reports a miss
		// every time
		await expect(check({ cwd, planPath, plan })).resolves.toStrictEqual([]);
	});

	test('an elided span is resolved by its tail — silent when a real file ends that way, reported when none does', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'Compare `.../PlanDetail/index.ts` with `.../PlanSummary/index.ts`.' });

		await expect(missing({ cwd, planPath, plan })).resolves.toStrictEqual(['path named in prose does not exist: PlanSummary/index.ts']);
	});

	test('a path the plan repeats yields one finding, at the line it first appeared on', async () => {
		const { cwd, planPath, plan } = setup({ prose: 'Read `src/gone.ts` first.\n\nThen `src/gone.ts` again, and `src/gone.ts` once more.' });

		const findings = await check({ cwd, planPath, plan });

		expect(findings.length).toBe(1);
		expect(findings[0]?.location).toBe('demo.md:5');
	});
});
