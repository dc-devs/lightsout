import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { standardsCheckCommand } from '#src/cli/standardsCheckCommand.ts';
import { type StandardsFinding, StandardsSeverity, StandardsSnapshot } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

// Mocked Imports
// -------------------------
// Both halves of the check are other modules' entry points with their own tests.
// What this file pins is what the command leaves on disk: the merged stream of
// both halves, written once, as the latest report and as the dated copy the
// standards trend reads.

interface RunStandardsCheckParams {
	cwd: string;
	path?: string;
	all?: boolean;
	writeBaseline?: boolean;
	persist?: boolean;
	onProgress?: (message: string) => void;
}

const mockRunStandardsCheck = jest.fn<(params: RunStandardsCheckParams) => Promise<{ findings: StandardsFinding[]; notes: string[] }>>();

interface ReviewStandardsParams {
	cwd: string;
	path?: string;
}

const mockReviewStandards = jest.fn<(params: ReviewStandardsParams) => Promise<{ findings: StandardsFinding[]; notes: string[] }>>();

jest.mock('#src/standardsCheck/index.ts', () => ({
	runStandardsCheck: (params: RunStandardsCheckParams) => mockRunStandardsCheck(params),
	listStandardsRules: () => Promise.resolve([]),
	// The writer stays real — what the command leaves on disk is the whole subject here.
	writeStandardsSnapshot: jest.requireActual<typeof import('#src/standardsCheck/index.ts')>('#src/standardsCheck/index.ts').writeStandardsSnapshot,
}));
jest.mock('#src/cli/reviewStandards.ts', () => ({ reviewStandards: (params: ReviewStandardsParams) => mockReviewStandards(params) }));
// -------------------------

const finding = (overrides: Partial<StandardsFinding> = {}): StandardsFinding => ({
	rule: 'size-function',
	severity: StandardsSeverity.Advisory,
	siteKey: 'size:one',
	files: [{ path: 'src/a.ts' }],
	detail: '81 lines',
	...overrides,
});

const setupCheck = ({
	args = [],
	check = {},
	review = {},
}: {
	args?: string[];
	check?: { findings?: StandardsFinding[]; notes?: string[] };
	review?: { findings?: StandardsFinding[]; notes?: string[] };
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-standards-persist-'));
	const captured = captureCommandOutput();

	mockRunStandardsCheck.mockResolvedValue({ findings: check.findings ?? [], notes: check.notes ?? [] });
	mockReviewStandards.mockResolvedValue({ findings: review.findings ?? [], notes: review.notes ?? [] });

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

/** The typed evidence file, as the command left it — or undefined when it wrote none. */
const writtenReport = ({ cwd }: { cwd: string }) => {
	try {
		return JSON.parse(readFileSync(join(cwd, '.lightsout', 'standards-check.json'), 'utf8')) as {
			at: string;
			path: string;
			findings: StandardsFinding[];
			notes: string[];
		};
	} catch {
		return undefined;
	}
};

/** The latest report's bytes, exactly as the command left them on disk. */
const writtenReportText = ({ cwd }: { cwd: string }) => readFileSync(join(cwd, '.lightsout', 'standards-check.json'), 'utf8');

/** The dated copies the command left beside the latest report. */
const datedSnapshots = ({ cwd }: { cwd: string }) => {
	try {
		return readdirSync(join(cwd, '.lightsout', 'standards-check'));
	} catch {
		return [];
	}
};

/** What the command handed the standards check. */
const checkParams = () => mockRunStandardsCheck.mock.calls[0]?.[0];

describe('standardsCheckCommand persistence', () => {
	test('the command writes the merged stream itself, so one run leaves one report', async () => {
		const { context, cwd } = setupCheck({
			args: [],
			check: {
				findings: [finding({ rule: 'clone', severity: StandardsSeverity.Blocking, siteKey: 'clone:src/a.ts:1' })],
				notes: ['3 site(s) held back by the baseline'],
			},
			review: { findings: [finding({ rule: 'path-aliases', siteKey: 'path-aliases:src/a.ts' })] },
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// the check never writes it — two writers to one file would race
		expect(checkParams()?.persist).toBe(false);

		const written = writtenReport({ cwd });

		expect(written?.path).toBe('.');
		expect(written?.findings.map((entry) => entry.rule)).toStrictEqual(['clone', 'path-aliases']);
		expect(written?.notes).toStrictEqual(['3 site(s) held back by the baseline']);

		const dated = datedSnapshots({ cwd });

		// the same merged stream is kept as a dated copy, so a run the user took
		// deliberately becomes one point on the standards trend
		expect(dated.length).toBe(1);
		expect(JSON.parse(readFileSync(join(cwd, '.lightsout', 'standards-check', dated[0]), 'utf8'))).toStrictEqual(written);
	});

	test('a run scoped to a subpath records that scope, so partial evidence is never read as a whole-repo check', async () => {
		const { context, cwd } = setupCheck({ args: ['--code-checks', '--path', 'src/cli'] });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(writtenReport({ cwd })?.path).toBe('src/cli');
	});

	test('one clock reading names both files, so the report and its dated copy cannot disagree about when the check ran', async () => {
		const { context, cwd } = setupCheck({ check: { findings: [finding()] } });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		const written = writtenReport({ cwd });

		// the file a reader parses at the boundary, so a value the contract rejects
		// would be evidence no consumer could open
		expect(StandardsSnapshot.safeParse(written).success).toBe(true);
		expect(Number.isNaN(Date.parse(written?.at ?? ''))).toBe(false);
		// and the dated copy is named from that same instant, never a second reading
		expect(datedSnapshots({ cwd })).toStrictEqual([`${written?.at.replaceAll(':', '-').replaceAll('.', '-')}.json`]);
	});

	test('the agent half’s notes are recorded too, so the evidence file states everything the run reported', async () => {
		const { context, cwd } = setupCheck({
			args: [],
			check: { findings: [finding()], notes: ['3 site(s) held back by the baseline'] },
			review: { notes: ['agent review skipped — agent invocation failed: spawn claude ENOENT'] },
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// what was written is the merged run, not the machine half alone — a reader
		// of the file would otherwise believe the review had nothing to say
		expect(writtenReport({ cwd })?.notes).toStrictEqual([
			'3 site(s) held back by the baseline',
			'agent review skipped — agent invocation failed: spawn claude ENOENT',
		]);
	});

	test('the evidence file keeps the byte layout its readers parse: tab-indented, keys in order, one trailing newline', async () => {
		const { context, cwd } = setupCheck({ check: { findings: [finding()], notes: ['3 site(s) held back by the baseline'] } });

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		const raw = writtenReportText({ cwd });

		// the refactor pipeline reads this file as its work-list, and every consumer
		// repo commits it — a reordered key or a lost newline is a diff everywhere
		expect(Object.keys(JSON.parse(raw) as Record<string, unknown>)).toStrictEqual(['at', 'path', 'findings', 'notes']);
		expect(raw.startsWith('{\n\t"at": "')).toBe(true);
		expect(raw.endsWith('}\n')).toBe(true);
	});

	test('a review-only run prints but writes nothing — the evidence file is the machine half’s', async () => {
		const { context, cwd, logged } = setupCheck({
			args: ['--agent-review'],
			review: { findings: [finding({ rule: 'path-aliases', siteKey: 'path-aliases:src/a.ts' })] },
		});

		await expect(standardsCheckCommand(context)).rejects.toThrow(/process\.exit/);

		expect(writtenReport({ cwd })).toBe(undefined);
		// and it contributes no trend point either — a judgment call is not a measurement
		expect(datedSnapshots({ cwd })).toStrictEqual([]);
		// and it does not claim a report a reader could go open
		expect(logged.some((line) => line.startsWith('report: '))).toBe(false);
	});
});
