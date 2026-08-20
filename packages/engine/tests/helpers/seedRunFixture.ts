import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { seedConfiguredCwd } from '#tests/helpers/seedConfiguredCwd.ts';

interface Params {
	status: string;
	pipeline?: string;
	lock?: { pid: number; runId: string };
	/** Extra run dirs written verbatim — a malformed body is how the skip-unreadable path is reachable. */
	extraManifests?: { runId: string; body: string }[];
}

/**
 * One seeded run manifest — enough for every `status` line and every `resume`
 * pre-flight refusal, none of which spawn a harness. `lock` plants
 * .lightsout/lock.json, the live-process probe that tells a genuinely running
 * run apart from a crash leftover.
 */
export const seedRunFixture = async ({ status, pipeline, lock, extraManifests = [] }: Params): Promise<{ cwd: string; runId: string; updatedAt: string }> => {
	const cwd = await seedConfiguredCwd();
	const runId = 'run-fixture';
	const runDir = join(cwd, '.lightsout', 'runs', runId);
	const now = new Date().toISOString();

	await mkdir(runDir, { recursive: true });
	await writeFile(
		join(runDir, 'manifest.json'),
		JSON.stringify({
			runId,
			createdAt: now,
			updatedAt: now,
			plan: 'plans/demo.md',
			pipeline,
			harness: 'claude-code',
			status,
			currentStep: null,
			steps: [],
			changedFiles: [],
		}),
		'utf8',
	);

	if (lock) {
		await writeFile(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ ...lock, startedAt: now }), 'utf8');
	}

	for (const extra of extraManifests) {
		await mkdir(join(cwd, '.lightsout', 'runs', extra.runId), { recursive: true });
		await writeFile(join(cwd, '.lightsout', 'runs', extra.runId, 'manifest.json'), extra.body, 'utf8');
	}

	return { cwd, runId, updatedAt: now };
};
