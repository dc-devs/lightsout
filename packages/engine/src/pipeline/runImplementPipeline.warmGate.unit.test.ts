import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from '@jest/globals';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

test('write-tests warm gate: a real driver stream event releases the held-back writer before the warm one finishes, and the events still reach the transcript', async () => {
	const dir = setupConsumerRepo();
	const log: string[] = [];
	let writers = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, onEvent }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writers += 1;
				const writer = writers;

				log.push(`start:${writer}`);

				// The warm writer streams two events, then keeps working: the
				// gate must open on the FIRST event, not on settlement.
				if (writer === 1) {
					onEvent?.({ type: 'assistant', note: 'first-event' });
					onEvent?.({ type: 'assistant', note: 'second-event' });
					await delay(30);
				}

				log.push(`end:${writer}`);

				return { text: report(), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/a.js'), 'export const a = 1;\n');
			writeFileSync(join(dir, 'src/b.js'), 'export const b = 1;\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'src/a.js', summary: 'a' },
						{ path: 'src/b.js', summary: 'b' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(true);
	// two changed files → two writer groups
	expect(writers).toBe(2);
	// the warm writer spawns first
	expect(log.indexOf('start:2') > log.indexOf('start:1')).toBeTruthy();
	// the held-back writer starts on the stream event — not when the warm writer
	// settles
	expect(log.indexOf('start:2') < log.indexOf('end:1')).toBeTruthy();

	// The first-event hook wraps the transcript sink — both events must still
	// land in the warm writer's stream file, in order.
	const agentsDir = join(dir, '.lightsout', 'runs', result.manifest.runId, 'agents');
	const warmTranscript = readdirSync(agentsDir)
		.filter((name) => name.startsWith('stream-') && name.includes('write-tests'))
		.sort()[0];
	const events = readFileSync(join(agentsDir, warmTranscript ?? ''), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as Record<string, unknown>);

	// the hook tees events through to the transcript unchanged
	expect(events.map((event) => event.note)).toStrictEqual(['first-event', 'second-event']);
});
