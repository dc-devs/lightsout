import { expect, describe, test } from '@jest/globals';
import { StandardsSeverity, type RefactorBatch, type StandardsFinding } from '@/contracts';
import type { Driver } from '@/drivers';
import { collectBatchAdvisories } from '@/refactor/collectBatchAdvisories';
import type { LoadedStandardsPackage, LoadedStandardsRule } from '@/standardsPackages';

const finding = (overrides: Partial<StandardsFinding> = {}): StandardsFinding => ({
	rule: 'size-function',
	severity: StandardsSeverity.Advisory,
	siteKey: 'size-function:src/a.ts',
	files: [{ path: 'src/a.ts' }],
	detail: '81 lines',
	...overrides,
});

const batch = ({ paths }: { paths: string[] }): RefactorBatch => ({
	id: 'batch-01:multi-export:src',
	rule: 'multi-export',
	folder: 'src',
	blocking: paths.map((path) => finding({ rule: 'multi-export', severity: StandardsSeverity.Blocking, siteKey: `multi-export:${path}`, files: [{ path }] })),
	advisories: [],
});

const judgmentRule: LoadedStandardsRule = {
	id: 'path-aliases',
	set: 'code',
	documentPath: 'code/style-guide/structure/import-paths',
	summary: 'a relative import in an aliased package',
	prose: 'the argument for the rule',
	channel: 'base',
	checked: false,
	defaultSeverity: StandardsSeverity.Advisory,
	defaultSettings: {},
	fixturesPath: '/packages/acme/path-aliases/fixtures',
};

const packageOf = ({ rules }: { rules: LoadedStandardsRule[] }): LoadedStandardsPackage => ({
	name: 'acme',
	formatVersion: 1,
	rootPath: '/packages/acme',
	documents: [],
	rules,
});

const setupDriver = ({ text }: { text: string }) => {
	const driver: Driver = { name: 'stub', invoke: async () => ({ text, exitCode: 0 }) };
	const progress: string[] = [];

	return { driver, progress, onProgress: (message: string) => progress.push(message) };
};

describe('collectBatchAdvisories', () => {
	test('every machine advisory standing on the batch’s files is included, whichever rule reported it', async () => {
		const { driver, onProgress } = setupDriver({ text: JSON.stringify({ findings: [] }) });

		const advisories = await collectBatchAdvisories({
			cwd: '/repo',
			driver,
			batch: batch({ paths: ['src/a.ts'] }),
			packages: [],
			channels: [],
			findings: [
				finding(),
				finding({ rule: 'dead-export', siteKey: 'dead-export:src/a.ts' }),
				// a different file's advisory belongs to a different batch
				finding({ rule: 'size-function', siteKey: 'size-function:src/b.ts', files: [{ path: 'src/b.ts' }] }),
				// and blocking work is never advice
				finding({ rule: 'multi-export', severity: StandardsSeverity.Blocking, siteKey: 'multi-export:src/a.ts' }),
			],
			timeoutMs: 1000,
			onProgress,
		});

		expect(advisories.map((entry) => entry.siteKey)).toStrictEqual(['size-function:src/a.ts', 'dead-export:src/a.ts']);
	});

	test('the agent’s read of the judgment rules joins the same list, after the machine’s', async () => {
		const { driver, onProgress } = setupDriver({
			text: JSON.stringify({ findings: [{ rule: 'path-aliases', files: [{ path: 'src/a.ts' }], detail: 'a relative import' }] }),
		});

		const advisories = await collectBatchAdvisories({
			cwd: '/repo',
			driver,
			batch: batch({ paths: ['src/a.ts'] }),
			packages: [packageOf({ rules: [judgmentRule] })],
			channels: [],
			findings: [finding()],
			timeoutMs: 1000,
			onProgress,
		});

		expect(advisories.map((entry) => entry.rule)).toStrictEqual(['size-function', 'path-aliases']);
		// and it arrives as advice, like everything else in this list
		expect(advisories[1]?.severity).toBe(StandardsSeverity.Advisory);
	});

	test('a review that could not run leaves a note against the batch and no findings', async () => {
		const { driver, progress, onProgress } = setupDriver({ text: 'prose, not a report' });

		const advisories = await collectBatchAdvisories({
			cwd: '/repo',
			driver,
			batch: batch({ paths: ['src/a.ts'] }),
			packages: [packageOf({ rules: [judgmentRule] })],
			channels: [],
			findings: [],
			timeoutMs: 1000,
			onProgress,
		});

		// the batch is still real work — a missing answer must not stop it
		expect(advisories).toStrictEqual([]);
		expect(progress.some((line) => line.startsWith('batch-01:multi-export:src: agent review skipped — '))).toBe(true);
	});
});
