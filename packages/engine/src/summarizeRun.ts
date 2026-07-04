import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { RunManifest } from '@lightsout/contracts';
import { getRunDir } from './getRunDir';
import { readFriction } from './readFriction';

const LedgerRecord = z.object({
	step: z.string(),
	outputTokens: z.number(),
	costUsd: z.number(),
});

const CommandRecord = z.object({
	durationMs: z.number().optional(),
	rerun: z.literal(true).optional(),
	skipped: z.literal(true).optional(),
});

const readJsonlRecords = async <Shape>({ path, schema }: { path: string; schema: z.ZodType<Shape> }) => {
	const raw = await readFile(path, 'utf8').catch(() => '');

	return raw
		.split('\n')
		.filter(Boolean)
		.flatMap((line) => {
			try {
				const parsed = schema.safeParse(JSON.parse(line));

				return parsed.success ? [parsed.data] : [];
			} catch {
				return [];
			}
		});
};

interface Params {
	cwd: string;
	manifest: RunManifest;
}

/**
 * Aggregate a run's evidence into one report card: wall time, gate time,
 * per-step time/invocations/tokens/cost/files, gate re-runs and skips,
 * rejected-report retries, and friction by area. Everything is computed
 * from what the run already persisted (manifest, agents.jsonl,
 * commands.jsonl, friction.jsonl, rejected-* files) — the summary is a
 * view, never a second source of truth. Supervisor invocations are
 * attributed to the step they supervised.
 */
export const summarizeRun = async ({ cwd, manifest }: Params) => {
	const runDir = getRunDir({ cwd, runId: manifest.runId });
	const ledger = await readJsonlRecords({ path: join(runDir, 'agents.jsonl'), schema: LedgerRecord });
	const commands = await readJsonlRecords({ path: join(runDir, 'commands.jsonl'), schema: CommandRecord });
	const agentFiles = await readdir(join(runDir, 'agents')).catch(() => [] as string[]);
	const friction = (await readFriction({ cwd })).filter((entry) => entry.runId === manifest.runId);

	const perStepUsage = new Map<string, { invocations: number; outputTokens: number; costUsd: number }>();

	for (const record of ledger) {
		const step = record.step.endsWith('-supervisor') ? record.step.slice(0, -'-supervisor'.length) : record.step;
		const totals = perStepUsage.get(step) ?? { invocations: 0, outputTokens: 0, costUsd: 0 };

		totals.invocations += 1;
		totals.outputTokens += record.outputTokens;
		totals.costUsd += record.costUsd;
		perStepUsage.set(step, totals);
	}

	const frictionByArea = new Map<string, number>();

	for (const entry of friction) {
		frictionByArea.set(entry.area, (frictionByArea.get(entry.area) ?? 0) + 1);
	}

	const { usage } = manifest;
	const readableInput = usage ? usage.cacheReadTokens + usage.cacheCreationTokens + usage.inputTokens : 0;

	return {
		wallMs: Math.max(0, Date.parse(manifest.updatedAt) - Date.parse(manifest.createdAt)),
		/** Sum of step durations — actual working time, unlike wall, which spans idle gaps between a failure and its resume. */
		activeMs: manifest.steps.reduce((total, step) => total + (step.durationMs ?? 0), 0),
		gateMs: commands.reduce((total, command) => total + (command.durationMs ?? 0), 0),
		usage,
		/** Share of all input the model read from cache — the run's cost-efficiency dial. */
		cacheReadShare: usage && readableInput > 0 ? usage.cacheReadTokens / readableInput : undefined,
		steps: manifest.steps.map((step) => ({
			id: step.id,
			status: step.status,
			attempts: step.attempts,
			durationMs: step.durationMs,
			changedFiles: step.changedFiles,
			...(perStepUsage.get(step.id) ?? { invocations: 0, outputTokens: 0, costUsd: 0 }),
		})),
		gates: {
			commands: commands.filter((command) => !command.skipped).length,
			reruns: commands.filter((command) => command.rerun).length,
			skipped: commands.filter((command) => command.skipped).length,
		},
		/** Final messages that failed their contract and cost a re-emit retry. */
		rejectedReports: agentFiles.filter((name) => name.startsWith('rejected-')).length,
		frictionByArea: [...frictionByArea.entries()].map(([area, count]) => ({ area, count })),
	};
};
