import { describe, expect, test } from '@jest/globals';
import { renderRunProgress } from '#src/cli/common/render/renderRunProgress.ts';
import { RunStatus } from '#src/contracts/index.ts';
import type { RunProgress, RunProgressRow } from '#src/views/index.ts';

/** The escape byte every ANSI sequence opens with, built rather than written, so no control character sits in this source. */
const escapeByte = String.fromCharCode(27);

/** The same line without its paint, so a painted block can be measured the way a terminal measures it. */
const plain = ({ text }: { text: string }) =>
	text
		.split(escapeByte)
		.map((part) => part.replace(/^\[[0-9;]*m/, ''))
		.join('');

const rowOf = (overrides: Partial<RunProgressRow> = {}): RunProgressRow => ({
	id: 'implement',
	status: RunStatus.Passed,
	attempts: 1,
	durationMs: 1_000,
	verification: undefined,
	...overrides,
});

/** The run the chosen layout was drawn against — same ids, statuses, attempt counts and durations. */
const sampleProgress = (overrides: Partial<RunProgress> = {}): RunProgress => ({
	runId: 'e643832a-0000-4000-8000-000000000000',
	shortId: 'e643832a',
	title: 'phase 8 · plans',
	status: RunStatus.Running,
	live: true,
	rows: [
		rowOf({ id: 'clean-slate', durationMs: 160_000 }),
		rowOf({ id: 'implement', durationMs: 1_951_000 }),
		rowOf({ id: 'verify-implement', attempts: 2, durationMs: 651_000 }),
		rowOf({ id: 'write-tests', durationMs: 581_000 }),
		rowOf({ id: 'verify-tests', attempts: 2, durationMs: 542_000 }),
		rowOf({ id: 'refactor', status: RunStatus.Running, durationMs: 0 }),
		rowOf({ id: 'verify-refactor', status: undefined, attempts: 0, durationMs: undefined }),
		rowOf({ id: 'format', status: undefined, attempts: 0, durationMs: undefined }),
	],
	elapsedMs: 4_203_000,
	changedFileCount: 79,
	costUsd: 43.54,
	now: 'step refactor — pass 1/3',
	awaitingShip: false,
	...overrides,
});

/** The block the layout was chosen as, line for line — the two rules widened to the table they bracket. */
const sampleBlock = [
	'phase 8 · plans                          e643832a',
	'─────────────────────────────────────────────────',
	' ✓  clean-slate          passed            2m 40s',
	' ✓  implement            passed           32m 31s',
	' ✓  verify-implement     passed (x2)      10m 51s',
	' ✓  write-tests          passed            9m 41s',
	' ✓  verify-tests         passed (x2)       9m 02s',
	' ▶  refactor             running           0m 00s',
	' ·  verify-refactor      —',
	' ·  format               —',
	'─────────────────────────────────────────────────',
	' elapsed 70m 03s · 79 files · $43.54',
	' now  step refactor — pass 1/3',
];

describe('renderRunProgress', () => {
	test('renders the chosen layout, line for line', () => {
		expect(renderRunProgress({ progress: sampleProgress() })).toStrictEqual(sampleBlock);
	});

	test('a step row is 49 columns wide and its outcome starts where the id column ends', () => {
		const first = renderRunProgress({ progress: sampleProgress() })[2] ?? '';

		// four columns of glyph and twenty-one of step id
		expect(first).toHaveLength(49);
		expect(first.indexOf('passed')).toBe(25);
	});

	test('the retry count appears only above one attempt', () => {
		const lines = renderRunProgress({ progress: sampleProgress() });

		expect(lines.filter((line) => line.includes('(x2)'))).toHaveLength(2);
		expect(lines.filter((line) => line.includes('(x1)'))).toStrictEqual([]);
	});

	test('a row the run has not reached ends at the em dash, with no outcome padding and no clock', () => {
		const lines = renderRunProgress({ progress: sampleProgress() });
		const pending = lines.find((line) => line.includes('verify-refactor')) ?? '';

		expect(pending).toBe(' ·  verify-refactor      —');
		expect(pending).toHaveLength(26);
	});

	test('a recorded pending row reads exactly as a row with no record at all — one meaning, one look', () => {
		const rows = [rowOf({ id: 'phase1.md', status: RunStatus.Pending, attempts: 0, durationMs: undefined })];

		// a phased coordinator seeds a pending record for every phase before
		// anything runs, so its not-yet-reached rows ARE recorded rows
		expect(renderRunProgress({ progress: sampleProgress({ rows }) })[2]).toBe(' ·  phase1.md            —');
	});

	test('an id wider than the sample widens only the id column, leaving the outcome and the clock where they were', () => {
		const rows = [rowOf({ id: 'a-very-long-step-name-indeed', durationMs: 160_000 })];

		expect(renderRunProgress({ progress: sampleProgress({ rows }) })[2]).toBe(' ✓  a-very-long-step-name-indeed  passed            2m 40s');
	});

	test('the short id ends flush with the rule', () => {
		const lines = renderRunProgress({ progress: sampleProgress() });

		expect(lines[0]).toHaveLength((lines[1] ?? '').length);
		expect(lines[0]?.endsWith('e643832a')).toBe(true);
	});

	test('a title long enough to overhang widens the rules rather than producing a negative pad', () => {
		const title = 'a plan folder with a very long name indeed, longer than the table';
		const lines = renderRunProgress({ progress: sampleProgress({ title }) });

		expect(lines[0]).toBe(`${title} e643832a`);
		expect(lines[1]).toHaveLength(title.length + 9);
	});

	test('a driver that reported no cost drops the cost segment rather than printing a zero', () => {
		const lines = renderRunProgress({ progress: sampleProgress({ costUsd: undefined }) });

		expect(lines.at(-2)).toBe(' elapsed 70m 03s · 79 files');
	});

	test('a run that has narrated nothing drops the now line entirely', () => {
		const lines = renderRunProgress({ progress: sampleProgress({ now: undefined }) });

		expect(lines.at(-1)).toBe(' elapsed 70m 03s · 79 files · $43.54');
	});

	test('the columns are measured on plain text, so a coloured glyph does not shift them', () => {
		const wasTty = process.stdout.isTTY;

		try {
			process.stdout.isTTY = true;

			const lines = renderRunProgress({ progress: sampleProgress() });

			// the paint is real — and every line still measures exactly as it did unpainted
			expect(lines[2]).not.toBe(plain({ text: lines[2] ?? '' }));
			expect(lines.map((line) => plain({ text: line }))).toStrictEqual(sampleBlock);
		} finally {
			process.stdout.isTTY = wasTty;
		}
	});

	test('a failed verification summary renders compact ordered diagnostics', () => {
		const verification = {
			failedFamilies: ['check', 'test'],
			repairAttempts: { check: 2, test: 1 },
			failures: [
				{ kind: 'check', group: 'root', command: 'pnpm check', exitCode: 1, outputTail: 'type error' },
				{ kind: 'test', group: 'api', command: 'pnpm test', exitCode: 1, outputTail: 'earlier\n final\tline ' },
			],
			needsFormatting: false,
			guidedRepairAttempted: true,
			supervisorDiagnosis: 'stale\n dependency\tgraph',
		};
		const lines = renderRunProgress({ progress: sampleProgress({ rows: [rowOf({ status: RunStatus.Escalated, verification })] }) });

		expect(lines).toContain(' verification  check, test · groups root, api · repairs check=2, test=1 · guided yes');
		expect(lines).toContain(' diagnosis     stale dependency graph');
		expect(lines).toContain(' last output   final line');
	});

	test('an in-process changed-file failure reports unavailable groups and no repairs', () => {
		const lines = renderRunProgress({
			progress: sampleProgress({
				rows: [
					rowOf({
						verification: {
							failedFamilies: ['changed-files-executed'],
							repairAttempts: {},
							failures: [],
							needsFormatting: false,
							guidedRepairAttempted: false,
						},
					}),
				],
			}),
		});

		expect(lines).toContain(' verification  changed-files-executed · groups unavailable · repairs none · guided no');
	});

	test('a recovered verification summary with no current families renders no diagnostics', () => {
		const lines = renderRunProgress({
			progress: sampleProgress({
				rows: [
					rowOf({
						verification: {
							failedFamilies: [],
							repairAttempts: { check: 1 },
							failures: [],
							needsFormatting: false,
							guidedRepairAttempted: false,
						},
					}),
				],
			}),
		});

		expect(lines.some((line) => line.startsWith(' verification'))).toBe(false);
	});

	test('diagnostic widths set both rules and ANSI paint preserves terminal geometry', () => {
		const wasTty = process.stdout.isTTY;

		try {
			process.stdout.isTTY = true;
			const lines = renderRunProgress({
				progress: sampleProgress({
					rows: [
						rowOf({
							verification: {
								failedFamilies: ['changed-files-executed'],
								repairAttempts: {},
								failures: [],
								needsFormatting: false,
								guidedRepairAttempted: false,
							},
						}),
					],
				}),
			});
			const plainLines = lines.map((line) => plain({ text: line }));
			const diagnostic = plainLines.find((line) => line.startsWith(' verification')) ?? '';
			const rules = plainLines.filter((line) => /^─+$/.test(line));

			expect(rules).toHaveLength(2);
			expect(rules.every((rule) => rule.length === diagnostic.length)).toBe(true);
			expect(plainLines[2]).toHaveLength(49);
		} finally {
			process.stdout.isTTY = wasTty;
		}
	});
});
