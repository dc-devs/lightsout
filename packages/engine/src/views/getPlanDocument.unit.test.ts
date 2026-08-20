import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { expect, test } from '@jest/globals';
import { PlanDocumentKind } from '#src/contracts/index.ts';
import { getPlanDocument } from '#src/views/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';

/** A repo holding two markdown plans, both frozen work-lists, one JSON answering to both, and two JSON files that are neither. */
const seedPlans = async () => {
	const cwd = await freshCwd();

	await mkdir(join(cwd, 'plans'), { recursive: true });
	await writeFile(join(cwd, 'plans', 'add-search.md'), '# Add search\n\nThe plan.\n', 'utf8');
	await writeFile(
		join(cwd, 'plans', 'worklist.json'),
		JSON.stringify({
			at: '2026-01-01T00:00:00.000Z',
			path: '.',
			all: false,
			batches: [{ id: 'batch-00:size-file:src', rule: 'size-file', folder: 'src', blocking: [], advisories: [] }],
		}),
		'utf8',
	);
	await writeFile(
		join(cwd, 'plans', 'coverage.json'),
		JSON.stringify({
			at: '2026-01-01T00:00:00.000Z',
			totals: [{ scope: 'engine', statementsPct: 91.5, passed: false }],
			files: [{ path: 'packages/engine/src/views/listRuns.ts', scope: 'engine', statementsPct: 62.5 }],
		}),
		'utf8',
	);
	await writeFile(
		join(cwd, 'plans', 'both.json'),
		JSON.stringify({
			at: '2026-01-01T00:00:00.000Z',
			path: '.',
			all: false,
			batches: [{ id: 'batch-00:size-file:src', rule: 'size-file', folder: 'src', blocking: [], advisories: [] }],
			totals: [{ scope: 'engine', statementsPct: 91.5, passed: false }],
			files: [{ path: 'packages/engine/src/views/listRuns.ts', scope: 'engine', statementsPct: 62.5 }],
		}),
		'utf8',
	);
	await writeFile(join(cwd, 'plans', 'empty.md'), '', 'utf8');
	await writeFile(join(cwd, 'plans', 'stranger.json'), JSON.stringify({ something: 'else' }), 'utf8');
	await writeFile(join(cwd, 'plans', 'torn.json'), '{ not json', 'utf8');

	return cwd;
};

test('a markdown plan comes back as its text', async () => {
	const cwd = await seedPlans();

	expect(await getPlanDocument({ cwd, path: 'plans/add-search.md' })).toStrictEqual({
		path: 'plans/add-search.md',
		kind: PlanDocumentKind.Markdown,
		text: '# Add search\n\nThe plan.\n',
	});
});

test('an empty markdown plan is text rather than an absence', async () => {
	const cwd = await seedPlans();

	// the read is tested against undefined and never against falsiness, so a plan
	// truncated to nothing still renders as an empty document
	expect(await getPlanDocument({ cwd, path: 'plans/empty.md' })).toStrictEqual({ path: 'plans/empty.md', kind: PlanDocumentKind.Markdown, text: '' });
});

test('a JSON plan is tried as each frozen work-list in turn', async () => {
	const cwd = await seedPlans();
	const refactor = await getPlanDocument({ cwd, path: 'plans/worklist.json' });
	const coverage = await getPlanDocument({ cwd, path: 'plans/coverage.json' });

	// a refactor run's frozen work-list parses into its batches
	expect(refactor.kind).toBe(PlanDocumentKind.Worklist);
	expect(refactor.worklist?.batches.map((batch) => batch.rule)).toStrictEqual(['size-file']);
	// a coverage run's frozen measurement is the other shape at the same filename
	expect(coverage.kind).toBe(PlanDocumentKind.CoverageWorklist);
	expect(coverage.coverageWorklist?.files).toStrictEqual([{ path: 'packages/engine/src/views/listRuns.ts', scope: 'engine', statementsPct: 62.5 }]);
	expect(coverage.coverageWorklist?.totals).toStrictEqual([{ scope: 'engine', statementsPct: 91.5, passed: false }]);
});

test('a JSON answering to both work-lists is read as the refactor one, because that shape is tried first', async () => {
	const cwd = await seedPlans();
	const planDocument = await getPlanDocument({ cwd, path: 'plans/both.json' });

	// neither schema rejects the other's extra keys, so the ORDER of the two
	// attempts is the whole contract — swapping them would silently retag every
	// such plan, and the drawer would render a measurement as a batch list
	expect(planDocument.kind).toBe(PlanDocumentKind.Worklist);
	expect(planDocument.worklist?.batches.map((batch) => batch.rule)).toStrictEqual(['size-file']);
	expect(planDocument.coverageWorklist).toBeUndefined();
});

test('a path naming nothing readable is a recorded absence, not a failure', async () => {
	const cwd = await seedPlans();

	// a plan deleted after its run is a normal state a reader has to render
	expect(await getPlanDocument({ cwd, path: 'plans/gone.md' })).toStrictEqual({ path: 'plans/gone.md', kind: PlanDocumentKind.Missing });
	// so is JSON that answers to neither work-list
	expect(await getPlanDocument({ cwd, path: 'plans/stranger.json' })).toStrictEqual({ path: 'plans/stranger.json', kind: PlanDocumentKind.Missing });
	// and so is a work-list truncated by a run that died mid-write
	expect(await getPlanDocument({ cwd, path: 'plans/torn.json' })).toStrictEqual({ path: 'plans/torn.json', kind: PlanDocumentKind.Missing });
});

test('plans are read only from inside the repo', async () => {
	const cwd = await seedPlans();

	// a traversal that climbs out is refused after resolution, never by inspecting the raw string
	expect((await getRejectionError({ promise: getPlanDocument({ cwd, path: '../../etc/passwd' }) })).message).toContain('outside the repo');
	// and so is an absolute path that never pretended to be relative
	expect((await getRejectionError({ promise: getPlanDocument({ cwd, path: resolve('/etc/passwd') }) })).message).toContain('outside the repo');
	// a sibling whose name merely starts with the root's is outside it too, which
	// a raw startsWith on the resolved path would wave through
	expect((await getRejectionError({ promise: getPlanDocument({ cwd, path: `../${basename(cwd)}-extra/plan.md` }) })).message).toContain('outside the repo');
});

test('a path that climbs but lands back inside the repo is read like any other plan', async () => {
	const cwd = await seedPlans();
	const planDocument = await getPlanDocument({ cwd, path: 'plans/../plans/add-search.md' });

	// the refusal turns on where the path RESOLVES, so a '..' that returns inside
	// the root is a plan, not a traversal — and the row reports the path as asked
	// for rather than the resolved one
	expect(planDocument).toStrictEqual({ path: 'plans/../plans/add-search.md', kind: PlanDocumentKind.Markdown, text: '# Add search\n\nThe plan.\n' });
});

test('the repo root itself is inside the repo, so a path that resolves to it is read rather than refused', async () => {
	const cwd = await seedPlans();

	// '.' resolves exactly to the root — the trailing-separator comparison must
	// not turn the boundary itself into a traversal, and reading a directory is
	// an absence like any other unreadable path
	expect(await getPlanDocument({ cwd, path: '.' })).toStrictEqual({ path: '.', kind: PlanDocumentKind.Missing });
});
