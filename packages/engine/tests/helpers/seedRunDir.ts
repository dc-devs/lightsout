import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunManifest } from '#src/contracts/index.ts';

interface Params {
	cwd: string;
	/** Merged over a minimal passing manifest; `runId` decides the directory. */
	manifest: Partial<RunManifest> & { runId: string };
	/** JSONL bodies written into the run dir verbatim, so malformed lines are reachable. */
	logs?: { agents?: string; commands?: string };
	/** The frozen work-list, written verbatim so an unparseable one is reachable. */
	worklist?: string;
}

/**
 * One run directory on disk: a manifest, and whatever evidence files the case
 * needs beside it. Written rather than produced by a pipeline, so a reader's
 * tests can pin shapes no real run would conveniently produce.
 */
export const seedRunDir = async ({ cwd, manifest, logs, worklist }: Params): Promise<string> => {
	const runDir = join(cwd, '.lightsout', 'runs', manifest.runId);
	const at = '2026-01-01T00:00:00.000Z';

	await mkdir(runDir, { recursive: true });
	await writeFile(
		join(runDir, 'manifest.json'),
		JSON.stringify({
			createdAt: at,
			updatedAt: at,
			plan: 'plans/demo/plan.md',
			harness: 'claude-code',
			status: 'passed',
			currentStep: null,
			steps: [],
			changedFiles: [],
			packages: [],
			...manifest,
		}),
		'utf8',
	);

	if (logs?.agents !== undefined) {
		await writeFile(join(runDir, 'agents.jsonl'), logs.agents, 'utf8');
	}

	if (logs?.commands !== undefined) {
		await writeFile(join(runDir, 'commands.jsonl'), logs.commands, 'utf8');
	}

	if (worklist !== undefined) {
		await writeFile(join(runDir, 'worklist.json'), worklist, 'utf8');
	}

	return runDir;
};
