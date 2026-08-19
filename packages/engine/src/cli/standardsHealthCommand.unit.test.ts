import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { standardsHealthCommand } from '@/cli/standardsHealthCommand';
import type { LightsoutConfig } from '@/contracts';
import type { StandardsHealth } from '@/standardsCheck';
import type { LoadedStandardsPackage } from '@/standardsPackages';

// Mocked Imports
// -------------------------
// Loading a package off disk and aggregating a repo's run history are other
// modules' entry points, each with its own tests. What this command owns is what
// it hands them, that it renders the result, and how it ends.

interface BuildStandardsHealthParams {
	cwd: string;
	packages: LoadedStandardsPackage[];
}

const mockBuildStandardsHealth = jest.fn<(params: BuildStandardsHealthParams) => Promise<StandardsHealth>>();

interface ResolveStandardsPackagesParams {
	cwd: string;
	config?: LightsoutConfig;
}

const mockResolveStandardsPackages = jest.fn<(params: ResolveStandardsPackagesParams) => Promise<LoadedStandardsPackage[]>>();

jest.mock('@/standardsCheck', () => ({ buildStandardsHealth: (params: BuildStandardsHealthParams) => mockBuildStandardsHealth(params) }));
jest.mock('@/standardsPackages', () => ({ resolveStandardsPackages: (params: ResolveStandardsPackagesParams) => mockResolveStandardsPackages(params) }));
// -------------------------

const loadedPackage: LoadedStandardsPackage = { name: 'acme', formatVersion: 1, rootPath: '/packages/acme', documents: [], rules: [] };

/** The command over a repo on disk — one holding the given config, or one holding none. */
const setupCommand = ({ health, config }: { health?: StandardsHealth; config?: Record<string, unknown> } = {}) => {
	const captured = captureCommandOutput();
	const cwd = config === undefined ? mkdtempSync(join(tmpdir(), 'lightsout-test-')) : setupConsumerRepo({ git: false, config });

	mockResolveStandardsPackages.mockResolvedValue([loadedPackage]);
	mockBuildStandardsHealth.mockResolvedValue(
		health ?? {
			rules: [
				{
					id: 'multi-export',
					set: 'code',
					documentPath: 'code/style-guide/structure/one-export-per-file',
					checked: true,
					attempted: 2,
					resolved: 1,
					declined: 1,
					untracked: 0,
					adviceApplied: 0,
					adviceDeclined: 0,
					reasons: ['[plan] the barrel would break'],
				},
			],
			totals: { rules: 1, checked: 1, judgment: 0 },
		},
	);

	return { context: { flags: parseFlags({ args: [] }), rest: [], cwd }, cwd, ...captured };
};

const cellsOf = ({ logged }: { logged: string[] }) =>
	logged
		.filter((line) => line.startsWith('│'))
		.map((line) =>
			line
				.split('│')
				.slice(1, -1)
				.map((cell) => cell.trim()),
		);

describe('standardsHealthCommand', () => {
	test('renders the report and exits 0 — it reports on the rules, never gates on the code', async () => {
		const { context, logged, errors, exitCodes } = setupCommand();

		await expect(standardsHealthCommand(context)).rejects.toThrow(/process\.exit/);

		expect(cellsOf({ logged })[1]).toStrictEqual(['multi-export', 'code', '2', '1', '1', '—', '50%', '—', '—']);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test("the repo's own config decides which packages the report has rows for", async () => {
		const { context, cwd } = setupCommand({ config: { 'standards-packages': ['standards/house-rules'] } });

		await expect(standardsHealthCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockResolveStandardsPackages.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({ cwd, config: expect.objectContaining({ 'standards-packages': ['standards/house-rules'] }) }),
		);
		// and the run history read is this repo's, beside those packages
		expect(mockBuildStandardsHealth.mock.calls[0]?.[0]).toStrictEqual({ cwd, packages: [loadedPackage] });
	});

	test('a repo with no config still gets an answer — the package lightsout ships, every rule at its default', async () => {
		const { context } = setupCommand();

		await expect(standardsHealthCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockResolveStandardsPackages.mock.calls[0]?.[0]?.config).toBe(undefined);
	});

	test('packages that cannot be loaded stop the command rather than printing an empty report', async () => {
		const { context, logged, exitCodes } = setupCommand();
		mockResolveStandardsPackages.mockRejectedValue(new Error('standards package "acme" could not be loaded'));

		await expect(standardsHealthCommand(context)).rejects.toThrow('standards package "acme" could not be loaded');

		expect(logged).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([]);
	});
});
