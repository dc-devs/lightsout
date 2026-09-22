import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { listRunIds } from '#src/runState/index.ts';

/**
 * A repository whose state directory holds exactly the folders and files a case
 * names, each given as its path segments below `.lightsout` — so a case states
 * which LOCATION a run sits in, which is the whole question this listing
 * answers now that runs are filed under the work they belong to.
 */
const setupStateDirs = ({ dirs = [], files = [] }: { dirs?: string[][]; files?: string[][] } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-run-ids-'));

	for (const segments of dirs) {
		mkdirSync(join(cwd, '.lightsout', ...segments), { recursive: true });
	}

	for (const segments of files) {
		mkdirSync(join(cwd, '.lightsout', ...segments.slice(0, -1)), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', ...segments), 'not a run\n');
	}

	return cwd;
};

describe('listRunIds', () => {
	test("lists one ticket's runs without reading another ticket's", async () => {
		const cwd = setupStateDirs({
			dirs: [
				['work-orders', 'lo-155-state-layout', 'runs', 'r2-second'],
				['work-orders', 'lo-155-state-layout', 'runs', 'r1-first'],
				['work-orders', 'lo-201-other-ticket', 'runs', 'a0-other-ticket'],
				['implement', 'runs', 'a0-loose-plan'],
			],
		});

		const runIds = await listRunIds({ cwd, workOrderName: 'lo-155-state-layout' });

		expect(runIds).toStrictEqual(['r1-first', 'r2-second']);
	});

	test('lists every run in every location when no ticket narrows it', async () => {
		const cwd = setupStateDirs({
			dirs: [
				['work-orders', 'lo-155-state-layout', 'runs', 'c3-ticket-run'],
				['work-orders', 'lo-201-other-ticket', 'runs', 'a1-other-ticket-run'],
				['work-orders', 'lo-9-no-runs-yet', 'runs'],
				['implement', 'runs', 'b2-loose-plan-run'],
				['direct', 'runs', 'd4-direct-run'],
				['refactor', 'runs', 'e5-refactor-run'],
				['coverage', 'runs', 'f6-coverage-run'],
				['queue', 'runs', 'g7-queue-run'],
			],
			files: [['implement', 'runs', 'README.md']],
		});

		const runIds = await listRunIds({ cwd });

		expect(runIds).toStrictEqual([
			'a1-other-ticket-run',
			'b2-loose-plan-run',
			'c3-ticket-run',
			'd4-direct-run',
			'e5-refactor-run',
			'f6-coverage-run',
			'g7-queue-run',
		]);
	});

	test('a repo with no run locations at all has no runs, not an error', async () => {
		const cwd = setupStateDirs();

		const runIds = await listRunIds({ cwd });

		expect(runIds).toStrictEqual([]);
	});
});
