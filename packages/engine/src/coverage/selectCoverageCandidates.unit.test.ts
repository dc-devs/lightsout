import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { linkTypescript } from '@tests/helpers/linkTypescript';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import type { CoverageFile, CoverageTotal } from '@/contracts';
import { selectCoverageCandidates } from '@/coverage/selectCoverageCandidates';

const file = ({ path, statementsPct = 10, scope = 'root' }: { path: string; statementsPct?: number; scope?: string }): CoverageFile => ({
	path,
	scope,
	statementsPct,
});

const total = ({ scope = 'root', passed = false }: { scope?: string; passed?: boolean } = {}): CoverageTotal => ({ scope, statementsPct: 40, passed });

/** A repo holding whichever files a case needs to classify. */
const setupRepo = ({ contents = {} }: { contents?: Record<string, string> } = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-candidates-'));

	for (const [path, content] of Object.entries(contents)) {
		mkdirSync(join(dir, path, '..'), { recursive: true });
		writeFileSync(join(dir, path), content);
	}

	return dir;
};

const select = async ({
	cwd,
	files,
	totals,
	setAside = [],
	standardsPackages = [],
	compiler,
}: {
	cwd: string;
	files: CoverageFile[];
	totals: CoverageTotal[];
	setAside?: string[];
	standardsPackages?: string[];
	compiler?: ReturnType<typeof resolveConsumerTypescript>;
}) =>
	(await selectCoverageCandidates({ cwd, measured: { files, totals }, setAsidePaths: new Set(setAside), standardsPackages, compiler })).map(
		(entry) => entry.path,
	);

describe('selectCoverageCandidates', () => {
	test('a check under a standards package’s tests/ set is source, not a test — the set name buys no exemption', async () => {
		const cwd = setupRepo();
		const files = [
			// under a standards package, tests/ is a document set — the checks in it
			// are source files a run must be able to target
			file({ path: 'packages/acme/tests/unit-testing/05-rule/check.ts', statementsPct: 0 }),
			// the package's own tests still say so in their filenames
			file({ path: 'packages/acme/common/utils/helper.unit.test.ts', statementsPct: 0 }),
		];

		expect(await select({ cwd, files, totals: [total()], standardsPackages: ['packages/acme'] })).toStrictEqual([
			'packages/acme/tests/unit-testing/05-rule/check.ts',
		]);
	});

	test('keeps the measurement’s worst-first order, so the round works the worst file first', async () => {
		const cwd = setupRepo();
		const files = [file({ path: 'src/a.ts', statementsPct: 4 }), file({ path: 'src/b.ts', statementsPct: 30 })];

		expect(await select({ cwd, files, totals: [total()] })).toStrictEqual(['src/a.ts', 'src/b.ts']);
	});

	test('a scope whose own gate is green earns no work', async () => {
		const cwd = setupRepo();
		const files = [file({ path: 'packages/api/src/a.ts', scope: 'api' }), file({ path: 'packages/web/src/b.ts', scope: 'web' })];

		const candidates = await select({ cwd, files, totals: [total({ scope: 'api' }), total({ scope: 'web', passed: true })] });

		expect(candidates).toStrictEqual(['packages/api/src/a.ts']);
	});

	test('set-aside files and fully covered files are both past being worth a writer', async () => {
		const cwd = setupRepo();
		const files = [file({ path: 'src/aside.ts' }), file({ path: 'src/done.ts', statementsPct: 100 }), file({ path: 'src/open.ts' })];

		expect(await select({ cwd, files, totals: [total()], setAside: ['src/aside.ts'] })).toStrictEqual(['src/open.ts']);
	});

	test('a test file in the summary is the instrument, never the target', async () => {
		const cwd = setupRepo();
		const files = [file({ path: 'src/a.unit.test.ts' }), file({ path: 'tests/helpers/setup.ts' }), file({ path: 'src/a.ts' })];

		// a misconfigured coverage collection can report test files
		expect(await select({ cwd, files, totals: [total()] })).toStrictEqual(['src/a.ts']);
	});

	test('a file outside the JS/TS family never earns an agent turn', async () => {
		const cwd = setupRepo();
		const files = [file({ path: 'src/styles.css' }), file({ path: 'src/a.tsx' })];

		expect(await select({ cwd, files, totals: [total()] })).toStrictEqual(['src/a.tsx']);
	});

	test('with the consumer’s TypeScript, barrels and type-only files are proven inert and dropped', async () => {
		const cwd = setupRepo({
			contents: {
				'src/barrel.ts': "export { value } from '@/elsewhere';\n",
				'src/types.ts': 'export interface Shape {\n\tside: number;\n}\n',
				'src/real.ts': 'export const value = () => 1;\n',
			},
		});

		linkTypescript({ dir: cwd });

		const files = [file({ path: 'src/barrel.ts' }), file({ path: 'src/types.ts' }), file({ path: 'src/real.ts' })];
		const compiler = resolveConsumerTypescript({ cwd });

		// these would head every work-list and decline every time
		expect(await select({ cwd, files, totals: [total()], compiler })).toStrictEqual(['src/real.ts']);
	});

	test('without a consumer TypeScript nothing is inert — the honest degradation, not a wrong answer', async () => {
		const cwd = setupRepo({ contents: { 'src/barrel.ts': "export { value } from '@/elsewhere';\n" } });

		expect(await select({ cwd, files: [file({ path: 'src/barrel.ts' })], totals: [total()] })).toStrictEqual(['src/barrel.ts']);
	});

	test('a measured file that vanished from disk keeps its place rather than being classified blind', async () => {
		const cwd = setupRepo({ contents: { 'src/here.ts': 'export const value = () => 1;\n' } });

		linkTypescript({ dir: cwd });

		const files = [file({ path: 'src/gone.ts' }), file({ path: 'src/here.ts' })];

		expect(await select({ cwd, files, totals: [total()], compiler: resolveConsumerTypescript({ cwd }) })).toStrictEqual(['src/gone.ts', 'src/here.ts']);
	});
});
