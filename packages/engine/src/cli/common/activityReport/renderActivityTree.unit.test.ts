import { describe, expect, test } from '@jest/globals';
import { buildActivityTree } from '#src/activity/index.ts';
import { renderActivityTree } from '#src/cli/common/activityReport/renderActivityTree.ts';
import type { ActivityMark, ConfigPricing, HarnessProcessMark } from '#src/contracts/index.ts';
import { ActivityLevelKind, ActivityMarkKind, Effort, ProcessEndReason, RunStatus } from '#src/contracts/index.ts';

/** The escape byte every ANSI sequence opens with, built rather than written, so no control character sits in this source. */
const escapeByte = String.fromCharCode(27);

/** The same line without its paint, so a painted table reads the way a terminal measures it. */
const plain = ({ text }: { text: string }) =>
	text
		.split(escapeByte)
		.map((part) => part.replace(/^\[[0-9;]*m/, ''))
		.join('');

/** Ten o'clock on the day these fixtures were written, plus however many minutes a mark sits after it. */
const at = ({ minute }: { minute: number }) => new Date(Date.UTC(2026, 8, 17, 10, 0, 0) + minute * 60_000).toISOString();

interface OpensParams {
	id: string;
	parentId?: string;
	level: ActivityLevelKind;
	label: string;
	minute: number;
}

const opens = ({ id, parentId, level, label, minute }: OpensParams): ActivityMark => ({
	kind: ActivityMarkKind.LevelStart,
	id,
	parentId,
	level,
	label,
	at: at({ minute }),
});

const closes = ({ id, minute }: { id: string; minute: number }): ActivityMark => ({
	kind: ActivityMarkKind.LevelEnd,
	id,
	at: at({ minute }),
	outcome: RunStatus.Passed,
});

type ProcessOverrides = Partial<Omit<HarnessProcessMark, 'kind' | 'levelId' | 'startedAt' | 'endedAt'>>;

/** One harness process on a level, from one minute to another, reporting everything until a case says it did not. */
const ran = ({ levelId, from, to, ...overrides }: { levelId: string; from: number; to: number } & ProcessOverrides): ActivityMark => ({
	kind: ActivityMarkKind.HarnessProcess,
	levelId,
	harness: 'claude-code',
	model: 'claude-opus-5',
	effort: Effort.High,
	spawn: 1,
	reemit: false,
	startedAt: at({ minute: from }),
	endedAt: at({ minute: to }),
	endReason: ProcessEndReason.Completed,
	usage: { inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 3000, cacheCreationTokens: 4000, costUsd: 1.5 },
	...overrides,
});

/** The fold the renderer is handed, built by the same function the command uses, so the totals are never hand-written ones the fold could disagree with. */
const reportOf = ({ marks }: { marks: ActivityMark[] }) => buildActivityTree({ plan: 'lo-150/plan-1', marks });

/** Every line of the table that carries cells — the rules are drawn with corners instead. */
const tableLines = ({ lines }: { lines: string[] }) => lines.map((text) => plain({ text })).filter((line) => line.includes('│'));

/** One plain line's cells exactly as they were padded, so indentation survives. */
const rawCells = ({ line }: { line: string }) => line.split('│').slice(1, -1);

const cellsOf = ({ line }: { line: string }) => rawCells({ line }).map((cell) => cell.trim());

const headerOf = ({ lines }: { lines: string[] }) => cellsOf({ line: tableLines({ lines })[0] ?? '' });

const bodyLines = ({ lines }: { lines: string[] }) => tableLines({ lines }).slice(1);

const columnOf = ({ lines, header }: { lines: string[]; header: RegExp }) => headerOf({ lines }).findIndex((cell) => header.test(cell));

/** The first row whose name cell answers to the given name. */
const lineFor = ({ lines, name }: { lines: string[]; name: RegExp }) => bodyLines({ lines }).find((line) => name.test(cellsOf({ line })[0] ?? '')) ?? '';

const cellFor = ({ lines, name, header }: { lines: string[]; name: RegExp; header: RegExp }) =>
	cellsOf({ line: lineFor({ lines, name }) })[columnOf({ lines, header })] ?? '';

/** How far a row's name cell is indented, which is how nesting reads. */
const indentOf = ({ line }: { line: string }) => (rawCells({ line })[0] ?? '').search(/\S/);

/**
 * The spawn number as a row names it: a digit standing on its own, never one
 * belonging to a clock time — the process rows carry both, and the clock is
 * rendered in whatever timezone the suite runs in.
 */
const namesSpawn = ({ cell, spawn }: { cell: string; spawn: number }) => new RegExp(`(^|[^\\d:])${spawn}(?![\\d:])`).test(cell);

const wallColumn = /wall|elapsed/i;
const agentColumn = /agent|engine/i;
const peakColumn = /peak|at once|concurren/i;
const shareColumn = /share|%/;
const inputColumn = /^in/i;
const outputColumn = /^out/i;
const cacheColumn = /^cache/i;
const costColumn = /^cost/i;
const estimateColumn = /estimat/i;

/** A share cell read back as the number it states. */
const shareOf = ({ lines, name }: { lines: string[]; name: RegExp }) => Number.parseFloat(cellFor({ lines, name, header: shareColumn }).replace('%', ''));

describe('renderActivityTree', () => {
	test("renderActivityTree: wall time, agent time and peak concurrency are separate columns, and children's shares of agent time sum to 100%", () => {
		// two steps overlapping inside one command run, the first of them running
		// two agents at once so its agent time is twice its own wall time
		const report = reportOf({
			marks: [
				opens({ id: 'cmd', level: ActivityLevelKind.CommandRun, label: 'plan draft', minute: 0 }),
				opens({ id: 'step-a', parentId: 'cmd', level: ActivityLevelKind.Step, label: 'draft-one', minute: 0 }),
				opens({ id: 'step-b', parentId: 'cmd', level: ActivityLevelKind.Step, label: 'draft-two', minute: 4 }),
				ran({ levelId: 'step-a', from: 0, to: 6 }),
				ran({ levelId: 'step-a', from: 0, to: 6, spawn: 2 }),
				ran({ levelId: 'step-b', from: 4, to: 16 }),
				closes({ id: 'step-a', minute: 6 }),
				closes({ id: 'step-b', minute: 16 }),
				closes({ id: 'cmd', minute: 20 }),
			],
		});

		const lines = renderActivityTree({ report });

		expect(columnOf({ lines, header: wallColumn })).not.toBe(columnOf({ lines, header: agentColumn }));
		expect({
			wall: cellFor({ lines, name: /draft-one/, header: wallColumn }),
			agent: cellFor({ lines, name: /draft-one/, header: agentColumn }),
			peak: cellFor({ lines, name: /draft-one/, header: peakColumn }),
		}).toStrictEqual({ wall: '6m 00s', agent: '12m 00s', peak: '2' });
		expect({
			wall: cellFor({ lines, name: /draft-two/, header: wallColumn }),
			agent: cellFor({ lines, name: /draft-two/, header: agentColumn }),
			peak: cellFor({ lines, name: /draft-two/, header: peakColumn }),
		}).toStrictEqual({ wall: '12m 00s', agent: '12m 00s', peak: '1' });
		// the command run's own wall time is 20m while its agents spent 24m, and
		// three of them were alive together between minute four and minute six
		expect({
			wall: cellFor({ lines, name: /plan draft/, header: wallColumn }),
			agent: cellFor({ lines, name: /plan draft/, header: agentColumn }),
			peak: cellFor({ lines, name: /plan draft/, header: peakColumn }),
		}).toStrictEqual({ wall: '20m 00s', agent: '24m 00s', peak: '3' });
		expect(shareOf({ lines, name: /draft-one/ }) + shareOf({ lines, name: /draft-two/ })).toBe(100);
	});

	test('renderActivityTree: a level with idle time draws its own labelled row for the time no agent was running', () => {
		// ten minutes of wall time with an agent alive for only four of them
		const report = reportOf({
			marks: [
				opens({ id: 'step', level: ActivityLevelKind.Step, label: 'grade-gaps', minute: 0 }),
				ran({ levelId: 'step', from: 0, to: 4 }),
				closes({ id: 'step', minute: 10 }),
			],
		});

		const lines = renderActivityTree({ report });

		const idle = /idle|no agent|nothing running/i;

		expect(cellFor({ lines, name: /grade-gaps/, header: wallColumn })).toBe('10m 00s');
		expect(lineFor({ lines, name: idle })).not.toBe('');
		expect(cellFor({ lines, name: idle, header: wallColumn })).toBe('6m 00s');
		// and it sits beneath the level whose seconds it accounts for
		expect(bodyLines({ lines }).indexOf(lineFor({ lines, name: idle }))).toBeGreaterThan(bodyLines({ lines }).indexOf(lineFor({ lines, name: /grade-gaps/ })));
	});

	test('renderActivityTree: the plan row shows elapsed and engine time with the waiting between command runs as its own row', () => {
		// an hour of drafting, an hour of the reader doing something else, an hour
		// of grading — and neither command run busy for its whole hour
		const report = reportOf({
			marks: [
				opens({ id: 'plan', level: ActivityLevelKind.Plan, label: 'planning observability', minute: 0 }),
				opens({ id: 'draft', parentId: 'plan', level: ActivityLevelKind.CommandRun, label: 'plan draft', minute: 0 }),
				ran({ levelId: 'draft', from: 0, to: 30 }),
				closes({ id: 'draft', minute: 60 }),
				opens({ id: 'grade', parentId: 'plan', level: ActivityLevelKind.CommandRun, label: 'plan grade', minute: 120 }),
				ran({ levelId: 'grade', from: 120, to: 165 }),
				closes({ id: 'grade', minute: 180 }),
				closes({ id: 'plan', minute: 180 }),
			],
		});

		const lines = renderActivityTree({ report });

		const waiting = /between|waiting/i;

		// elapsed spans both command runs; engine time is the two of them added up,
		// which is neither the elapsed time nor the 75m the agents actually spent
		expect({
			elapsed: cellFor({ lines, name: /planning observability/, header: wallColumn }),
			engine: cellFor({ lines, name: /planning observability/, header: agentColumn }),
		}).toStrictEqual({ elapsed: '180m 00s', engine: '120m 00s' });
		expect(cellFor({ lines, name: /plan draft/, header: wallColumn })).toBe('60m 00s');
		expect(cellFor({ lines, name: /plan grade/, header: wallColumn })).toBe('60m 00s');
		expect(lineFor({ lines, name: waiting })).not.toBe('');
		expect(cellFor({ lines, name: waiting, header: wallColumn })).toBe('60m 00s');
	});

	test('renderActivityTree: unreported tokens and an unfinished level render as not reported, never as zero', () => {
		// a step with no end mark, holding a process killed before it reported anything
		const report = reportOf({
			marks: [
				opens({ id: 'step', level: ActivityLevelKind.Step, label: 'draft-phase', minute: 0 }),
				ran({ levelId: 'step', from: 0, to: 5, endReason: ProcessEndReason.TimedOut, usage: undefined }),
			],
		});

		const lines = renderActivityTree({ report });

		const moneyColumns = [inputColumn, outputColumn, cacheColumn, costColumn];

		expect(moneyColumns.map((header) => cellFor({ lines, name: /claude-code/, header }))).toStrictEqual(['—', '—', '—', '—']);
		expect(moneyColumns.map((header) => cellFor({ lines, name: /draft-phase/, header }))).toStrictEqual(['—', '—', '—', '—']);
		expect(cellFor({ lines, name: /draft-phase/, header: wallColumn })).toBe('—');
		expect(lineFor({ lines, name: /draft-phase/ })).toMatch(/unfinished/i);
	});

	test('renderActivityTree: each harness process is a leaf row under its step, naming what it ran as and how it ended', () => {
		// one step, two spawns of the same request: the second is the cheap re-emit
		const report = reportOf({
			marks: [
				opens({ id: 'step', level: ActivityLevelKind.Step, label: 'draft-phase', minute: 0 }),
				ran({ levelId: 'step', from: 0, to: 10 }),
				ran({ levelId: 'step', from: 10, to: 20, spawn: 2, reemit: true, effort: Effort.Low, endReason: ProcessEndReason.TimedOut }),
				closes({ id: 'step', minute: 20 }),
			],
		});

		const lines = renderActivityTree({ report });

		const processLines = bodyLines({ lines }).filter((line) => /claude-code/.test(cellsOf({ line })[0] ?? ''));
		const [first = '', second = ''] = processLines;
		const firstName = cellsOf({ line: first })[0] ?? '';
		const secondName = cellsOf({ line: second })[0] ?? '';

		expect(processLines).toHaveLength(2);
		expect(firstName).toContain('claude-opus-5');
		expect(firstName).toMatch(/high/i);
		expect(namesSpawn({ cell: firstName, spawn: 1 })).toBe(true);
		expect(first).not.toMatch(/re-?emit/i);
		expect(first).toMatch(/completed/i);
		expect(secondName).toMatch(/low/i);
		expect(namesSpawn({ cell: secondName, spawn: 2 })).toBe(true);
		expect(second).toMatch(/re-?emit/i);
		expect(second).toMatch(/timed[ -]?out/i);
		// each row carries its own start and end clock time
		expect(first.match(/\d{1,2}:\d{2}/g) ?? []).toHaveLength(2);
		expect(second.match(/\d{1,2}:\d{2}/g) ?? []).toHaveLength(2);
		// and both hang beneath the step they ran inside
		expect(indentOf({ line: first })).toBeGreaterThan(indentOf({ line: lineFor({ lines, name: /draft-phase/ }) }));
		expect(bodyLines({ lines }).indexOf(first)).toBeGreaterThan(bodyLines({ lines }).indexOf(lineFor({ lines, name: /draft-phase/ })));
	});

	test('renderActivityTree: the estimated-cost column appears only with a price list and is labelled as an estimate', () => {
		const report = reportOf({
			marks: [
				opens({ id: 'step', level: ActivityLevelKind.Step, label: 'draft-phase', minute: 0 }),
				ran({ levelId: 'step', from: 0, to: 10 }),
				closes({ id: 'step', minute: 10 }),
			],
		});
		const pricing: ConfigPricing = { 'claude-opus-5': { input: 5, output: 25, 'cache-read': 0.5, 'cache-write': 6.25 } };

		const priced = renderActivityTree({ report, pricing });
		const unpriced = renderActivityTree({ report });

		const column = columnOf({ lines: priced, header: estimateColumn });
		const without = ({ cells }: { cells: string[] }) => cells.filter((_, index) => index !== column);

		expect(headerOf({ lines: priced }).filter((cell) => estimateColumn.test(cell))).toHaveLength(1);
		expect(headerOf({ lines: unpriced }).filter((cell) => estimateColumn.test(cell))).toHaveLength(0);
		expect(cellFor({ lines: priced, name: /draft-phase/, header: estimateColumn })).toMatch(/^\$/);
		// every other column is exactly what it was without the price list
		expect(without({ cells: headerOf({ lines: priced }) })).toStrictEqual(headerOf({ lines: unpriced }));
		expect(without({ cells: cellsOf({ line: lineFor({ lines: priced, name: /draft-phase/ }) }) })).toStrictEqual(
			cellsOf({ line: lineFor({ lines: unpriced, name: /draft-phase/ }) }),
		);
	});
});
