import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from '@jest/globals';
import {
	type FolderShape,
	gradedReport,
	metricLabels,
	nineWordSentence,
	phasedFolder,
	plainAfter,
	planWithFidelity,
	pricedStreams,
	readCells,
	readRows,
	resultLine,
	setupComparePlanDrafts,
	sevenWordSentence,
	singleFolder,
} from '#tests/helpers/comparePlanDraftsFixture.ts';

// The before/after comparison of two plan folders, run as the real subprocess
// `pnpm compare:plan-drafts` runs it. What it prints is a contract: one table,
// one line per metric, a stream counted in neither half never reappearing in
// the total, and an ungraded folder never reading as one that scored zero.
//
// Every case builds throwaway plan folders rather than pointing at this
// repository's `.lightsout/plans/`: a test anchored on a real folder would
// change its verdict every time a plan is drafted. The script is run where it
// lives, because it writes nothing, anywhere, ever.

const roots: string[] = [];

/** The fixture, with its temp root registered for removal — one call is a case's whole arrangement. */
const setupComparison = ({ before, after }: { before: FolderShape; after: FolderShape }) => {
	const fixture = setupComparePlanDrafts({ before, after });

	roots.push(fixture.root);

	return fixture;
};

afterAll(() => {
	for (const root of roots) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe('comparePlanDrafts', () => {
	test('prints one table with a column per plan folder and a change column', () => {
		const { run } = setupComparison({
			before: singleFolder({
				name: 'before-plan',
				body: nineWordSentence,
				streams: { 'draft-stream.jsonl': [resultLine({ costUsd: 1, durationMs: 60_000 })] },
			}),
			after: singleFolder({
				name: 'after-plan',
				body: nineWordSentence,
				streams: { 'draft-stream.jsonl': [resultLine({ costUsd: 2, durationMs: 120_000 })] },
			}),
		});

		const { ok, stdout } = run();
		const lines = stdout.split('\n').filter((line) => line.trim() !== '');
		const printed = metricLabels.map((label) => lines.filter((line) => new RegExp(`^\\s*${label}`, 'i').test(line)).length);

		expect(ok).toBe(true);
		expect(lines[0]).toMatch(/before-plan.*after-plan.*change/i);
		expect(printed).toStrictEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
		// each folder named on exactly one line is what makes it one table rather than a report per folder
		expect([lines.filter((line) => line.includes('before-plan')).length, lines.filter((line) => line.includes('after-plan')).length]).toStrictEqual([1, 1]);
	});

	test('sums drafting cost and time from the draft and repair streams and review cost and time from the grade and dedup streams', () => {
		const { run } = setupComparison({ before: singleFolder({ name: 'streams-before', streams: pricedStreams }), after: plainAfter });

		const { ok, stdout } = run();
		const rows = readRows({ stdout });

		expect(ok).toBe(true);
		expect(rows).toEqual(
			expect.objectContaining({
				'drafting cost': expect.stringMatching(/\$2\.00/),
				'drafting time': expect.stringMatching(/\s1\.5/),
				'review cost': expect.stringMatching(/\$3\.00/),
				'review time': expect.stringMatching(/\s3\.0/),
			}),
		);
		// counting the stray stream would read as $9.25 and 9.8 minutes drafting, $10.25 and 11.3 minutes review
		const halves = `${rows['drafting cost']}${rows['drafting time']}${rows['review cost']}${rows['review time']}`;

		expect(halves).not.toMatch(/9\.25|10\.25|9\.8|11\.3/);
	});

	test('reports total cost and total time as drafting plus review', () => {
		const { run } = setupComparison({ before: singleFolder({ name: 'totals-before', streams: pricedStreams }), after: plainAfter });

		const { ok, stdout } = run();
		const rows = readRows({ stdout });

		expect(ok).toBe(true);
		expect(rows).toEqual(expect.objectContaining({ 'total cost': expect.stringMatching(/\$5\.00/), 'total time': expect.stringMatching(/\s4\.5/) }));
		// the stray stream would surface here as $12.25 and 12.8 minutes if the total re-read the folder
		expect(`${rows['total cost']}${rows['total time']}`).not.toMatch(/12\.25|12\.8/);
	});

	test('reports the change column as the signed difference between the two folders', () => {
		const { run } = setupComparison({
			before: singleFolder({ name: 'cheaper-before', streams: { 'draft-stream.jsonl': [resultLine({ costUsd: 1, durationMs: 60_000 })] } }),
			after: singleFolder({ name: 'dearer-after', streams: { 'draft-stream.jsonl': [resultLine({ costUsd: 3.5, durationMs: 30_000 })] } }),
		});

		const { ok, stdout } = run();
		const rows = readRows({ stdout });

		expect(ok).toBe(true);
		// cost rose by $2.50 and time fell by half a minute, and the sign is what tells one direction from the other
		expect(readCells({ row: rows['drafting cost'] })).toStrictEqual(['drafting cost', '$1.00', '$3.50', '+$2.50']);
		expect(readCells({ row: rows['drafting time'] })).toStrictEqual(['drafting time', '1.0', '0.5', '-0.5']);
	});

	test('counts a repeated sentence of eight words or more and ignores a shorter repeat', () => {
		const { run } = setupComparison({
			before: phasedFolder({ name: 'repeats-before', body: `${nineWordSentence} ${sevenWordSentence}` }),
			after: plainAfter,
		});

		const { ok, stdout } = run();
		const rows = readRows({ stdout });

		expect(ok).toBe(true);
		expect(rows).toEqual(
			expect.objectContaining({ 'duplicated sentences': expect.stringMatching(/\s1/), 'duplicated characters': expect.stringMatching(/\s55/) }),
		);
		// counting the seven-word repeat as well would read as 2 sentences and 92 characters
		expect(`${rows['duplicated sentences']}${rows['duplicated characters']}`).not.toMatch(/2|92/);
	});

	test('treats sentences differing only in case, backticks and whitespace as the same sentence', () => {
		const { run } = setupComparison({
			before: phasedFolder({
				name: 'normalized-before',
				body: 'Every recorded decision keeps its provenance in the generated table.',
				phaseBody: 'EVERY  recorded `decision` keeps its   provenance in the generated table.',
			}),
			after: plainAfter,
		});

		const { ok, stdout } = run();
		const rows = readRows({ stdout });

		expect(ok).toBe(true);
		// 67 is the normalized sentence's length, and it only appears when both spellings collapsed to one
		expect(rows).toEqual(
			expect.objectContaining({ 'duplicated sentences': expect.stringMatching(/\s1/), 'duplicated characters': expect.stringMatching(/\s67/) }),
		);
	});

	test('ignores repeated lines inside fenced code blocks', () => {
		const fenced = ['', '```sh', 'node scripts/comparePlanDrafts.mjs before-folder after-folder and read the printed table', '```', ''].join('\n');
		const { run } = setupComparison({
			before: phasedFolder({ name: 'fenced-before', body: nineWordSentence, suffix: fenced }),
			after: plainAfter,
		});

		const { ok, stdout } = run();
		const rows = readRows({ stdout });

		expect(ok).toBe(true);
		expect(rows).toEqual(
			expect.objectContaining({ 'duplicated sentences': expect.stringMatching(/\s1/), 'duplicated characters': expect.stringMatching(/\s55/) }),
		);
		// the prose repeat alone is 1; counting the fenced line as a second repeat would read as 2
		expect(rows['duplicated sentences']).not.toMatch(/2/);
	});

	test('reads acceptance-test rows and prose files from the plan files and blocking gaps and structural findings from grade.json', () => {
		const { run } = setupComparison({
			before: {
				name: 'fidelity-before',
				files: { 'plan.md': planWithFidelity({ heading: 'Fidelity before', acceptance: 3, prose: 2 }) },
				grade: gradedReport,
			},
			after: {
				name: 'fidelity-after',
				files: { 'plan.md': planWithFidelity({ heading: 'Fidelity after', acceptance: 1, prose: 1 }) },
				grade: { structural: [], gaps: [] },
			},
		});

		const { ok, stdout } = run();
		const rows = readRows({ stdout });

		expect(ok).toBe(true);
		expect(rows).toEqual(
			expect.objectContaining({
				acceptance: expect.stringMatching(/\s3\s/),
				prose: expect.stringMatching(/\s2\s/),
				blocking: expect.stringMatching(/\s4\s/),
				structural: expect.stringMatching(/\s5\s/),
			}),
		);
		// counting all seven gaps rather than the four blocking ones would read as 7
		expect(rows.blocking).not.toMatch(/7/);
	});

	test('reports the grade-derived figures as unavailable when the folder has no grade.json', () => {
		const { run } = setupComparison({
			before: { name: 'ungraded-before', files: { 'plan.md': planWithFidelity({ heading: 'Ungraded before', acceptance: 3, prose: 2 }) } },
			after: { name: 'ungraded-after', files: { 'plan.md': planWithFidelity({ heading: 'Ungraded after', acceptance: 1, prose: 1 }) } },
		});

		const { ok, stdout } = run();
		const rows = readRows({ stdout });

		expect(ok).toBe(true);
		// a figure that was never measured carries no number at all, in its own cell or in the change cell
		expect(`${rows.blocking}${rows.structural}`).not.toMatch(/\d/);
		expect(rows).toEqual(expect.objectContaining({ acceptance: expect.stringMatching(/\s3\s/), prose: expect.stringMatching(/\s2\s/) }));
	});

	test('reports the grade-derived figures as unavailable when grade.json no longer parses', () => {
		const { run } = setupComparison({
			before: {
				name: 'unreadable-before',
				files: { 'plan.md': planWithFidelity({ heading: 'Unreadable before', acceptance: 2, prose: 1 }) },
				gradeText: '{"structural": [], "gaps": [',
			},
			after: {
				name: 'readable-after',
				files: { 'plan.md': planWithFidelity({ heading: 'Readable after', acceptance: 1, prose: 1 }) },
				grade: gradedReport,
			},
		});

		const { ok, stdout } = run();
		const rows = readRows({ stdout });

		expect(ok).toBe(true);
		// the graded side is measured and the truncated side is not, so the change between them cannot be stated either
		expect(readCells({ row: rows.blocking })).toStrictEqual(['blocking gaps', 'n/a', '4', 'n/a']);
		expect(readCells({ row: rows.structural })).toStrictEqual(['structural findings', 'n/a', '5', 'n/a']);
		expect(readCells({ row: rows.acceptance })).toStrictEqual(['acceptance-test rows', '2', '1', '-1']);
	});

	test('skips a malformed stream line and a non-result line instead of failing', () => {
		const draftLines = [
			resultLine({ costUsd: 1, durationMs: 60_000 }),
			'{"type":"result","total_cost_usd":2,"durat',
			'{"type":"assistant","message":{"role":"assistant"}}',
			resultLine({ costUsd: 3, durationMs: 120_000 }),
		];
		const { run } = setupComparison({
			before: singleFolder({ name: 'tolerant-before', streams: { 'draft-stream.jsonl': draftLines } }),
			after: plainAfter,
		});

		const { ok, stdout } = run();
		const rows = readRows({ stdout });

		expect(ok).toBe(true);
		expect(rows).toEqual(expect.objectContaining({ 'drafting cost': expect.stringMatching(/\$4\.00/), 'drafting time': expect.stringMatching(/\s3\.0/) }));
		// reading the truncated line's two dollars anyway would read as $6.00
		expect(rows['drafting cost']).not.toMatch(/\$6\.00/);
	});

	test('falls back to duration_api_ms and counts an event carrying neither figure as nothing', () => {
		const draftLines = [
			JSON.stringify({ type: 'result', total_cost_usd: 1, duration_api_ms: 60_000 }),
			JSON.stringify({ type: 'result', total_cost_usd: 2, duration_ms: 30_000, duration_api_ms: 600_000 }),
			JSON.stringify({ type: 'result', session_id: 'ended-before-it-was-billed' }),
		];
		const { run } = setupComparison({
			before: singleFolder({ name: 'partial-before', streams: { 'draft-stream.jsonl': draftLines } }),
			after: plainAfter,
		});

		const { ok, stdout } = run();
		const rows = readRows({ stdout });

		expect(ok).toBe(true);
		// $3.00 over 1.5 minutes: the fallback fills in for the missing duration_ms, and never overrides the one that is there
		expect(readCells({ row: rows['drafting cost'] })).toStrictEqual(['drafting cost', '$3.00', '$0.00', '-$3.00']);
		expect(readCells({ row: rows['drafting time'] })).toStrictEqual(['drafting time', '1.5', '0.0', '-1.5']);
	});

	test('fails with a usage message when fewer than two folders are given', () => {
		const { run, beforePath } = setupComparison({ before: singleFolder({ name: 'lonely-before' }), after: plainAfter });

		const { ok, stdout, stderr } = run({ args: [beforePath] });

		expect(ok).toBe(false);
		expect(stderr).toMatch(/folder/i);
		expect(stdout).not.toMatch(/^\s*drafting cost/im);
	});

	test('fails naming the argument when a folder is missing or holds no plan file', () => {
		const { run, beforePath, afterPath } = setupComparison({
			before: singleFolder({ name: 'named-before' }),
			after: { name: 'no-plan-files', streams: { 'draft-stream.jsonl': [resultLine({ costUsd: 1, durationMs: 60_000 })] } },
		});
		const missingPath = join(beforePath, '..', 'never-drafted');

		// one criterion, three shapes of bad argument: a path that is not a directory, a directory holding no plan file, and a path that is not there at all
		const notADirectory = run({ args: [join(beforePath, 'plan.md'), afterPath] });
		const noPlanFile = run({ args: [beforePath, afterPath] });
		const missing = run({ args: [missingPath, afterPath] });

		expect([notADirectory.ok, noPlanFile.ok, missing.ok]).toStrictEqual([false, false, false]);
		// the offending path in full, so the message names the argument rather than the shape a plan folder has
		expect(notADirectory.stderr).toContain(join(beforePath, 'plan.md'));
		expect(noPlanFile.stderr).toContain(afterPath);
		expect(missing.stderr).toContain(join(beforePath, '..', 'never-drafted'));
		expect(`${notADirectory.stdout}${noPlanFile.stdout}${missing.stdout}`).not.toMatch(/^\s*drafting cost/im);
	});

	test('leaves both plan folders byte for byte as it found them', () => {
		const { run, beforePath, snapshot } = setupComparison({
			before: singleFolder({
				name: 'untouched-before',
				streams: { 'draft-stream.jsonl': [resultLine({ costUsd: 1, durationMs: 60_000 })] },
				grade: { structural: [], gaps: [{ outcome: 'needs-a-human' }] },
			}),
			after: singleFolder({ name: 'untouched-after', streams: { 'grade-plan-surface-stream.jsonl': [resultLine({ costUsd: 2, durationMs: 30_000 })] } }),
		});
		const before = snapshot();

		run();
		const afterSuccess = snapshot();
		run({ args: [beforePath] });
		const afterFailure = snapshot();

		expect(afterSuccess).toStrictEqual(before);
		expect(afterFailure).toStrictEqual(before);
	});

	test('does nothing when the module is imported instead of run', () => {
		const { importModule } = setupComparison({ before: singleFolder({ name: 'imported-before' }), after: plainAfter });

		const printed = importModule();

		expect(printed).toBe('undefined');
	});
});
