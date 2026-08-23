import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { checkSourceWalk } from '#src/doctor/checkSourceWalk.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Mocked Imports
// -------------------------
// The walk itself is `common/sourceFiles`' to test. What this check owns is the
// comparison — so the failing case is the one where the walk returns less than
// git tracks, which is exactly what a stubbed walk can express and a real one
// (correct today) cannot.
interface ListSourceFilesResult {
	files: string[];
	standardsPacks: string[];
}

const mockListSourceFiles = jest.fn<() => Promise<ListSourceFilesResult>>();
const actual = jest.requireActual<typeof import('#src/common/sourceFiles/listSourceFiles.ts')>('#src/common/sourceFiles/listSourceFiles.ts');

jest.mock('#src/common/sourceFiles/listSourceFiles.ts', () => ({
	listSourceFiles: (params: { cwd: string; exclude?: string[] }) =>
		mockListSourceFiles.mock.calls.length > 0 || mockListSourceFiles.getMockImplementation() !== undefined
			? mockListSourceFiles()
			: actual.listSourceFiles(params),
}));
// -------------------------

/** A source file git tracks — staged, because `git ls-files` reads the index. */
const trackFile = ({ cwd, path }: { cwd: string; path: string }) => {
	mkdirSync(join(cwd, path.split('/').slice(0, -1).join('/')), { recursive: true });
	writeFileSync(join(cwd, path), 'export const value = 1;\n');
	execFileSync('git', ['add', path], { cwd, stdio: 'ignore' });
};

describe('checkSourceWalk', () => {
	test('a src/coverage folder is read, not hidden — the blind spot that cost nineteen files', async () => {
		const cwd = setupConsumerRepo();

		trackFile({ cwd, path: 'packages/engine/src/coverage/runCoverage.ts' });

		const check = await checkSourceWalk({ cwd });

		// `coverage` beside src is jest's report directory; inside src it is a
		// module. Skipping the name everywhere is what hid the second one.
		expect(check.status).toBe('pass');
	});

	test('build output beside src stays skipped, and is accounted for rather than reported', async () => {
		const cwd = setupConsumerRepo();

		trackFile({ cwd, path: 'packages/engine/dist/bundle.js' });

		const check = await checkSourceWalk({ cwd });

		expect(check.status).toBe('pass');
	});

	test('a declared generated path is a reason, not a blind spot', async () => {
		const cwd = setupConsumerRepo();

		trackFile({ cwd, path: 'packages/web/src/routeTree.gen.ts' });

		const check = await checkSourceWalk({ cwd, generated: ['packages/web/src/routeTree.gen.ts'] });

		expect(check.status).toBe('pass');
	});

	test('a tracked file the walk never reads fails, and is named', async () => {
		const cwd = setupConsumerRepo();

		trackFile({ cwd, path: 'packages/engine/src/plan/runPlan.ts' });
		// The walk having quietly stopped returning it — which is the shape of
		// every blind spot: fewer files, no error.
		// Everything EXCEPT the new file still returned, so the assertion is about
		// this file rather than about whatever the helper repo seeds.
		const { files, standardsPacks } = await actual.listSourceFiles({ cwd });

		mockListSourceFiles.mockResolvedValue({ files: files.filter((file) => !file.endsWith('runPlan.ts')), standardsPacks });

		const check = await checkSourceWalk({ cwd });

		expect(check.status).toBe('fail');
		expect(check.detail).toContain('packages/engine/src/plan/runPlan.ts');
		expect(check.detail).toMatch(/tracked source file\(s\) the walk never reads/);
	});

	test('a repo without git says so rather than claiming the walk is complete', async () => {
		const cwd = setupConsumerRepo({ git: false });

		const check = await checkSourceWalk({ cwd });

		expect(check.status).toBe('warn');
		expect(check.detail).toMatch(/not a git repository/);
	});
});
