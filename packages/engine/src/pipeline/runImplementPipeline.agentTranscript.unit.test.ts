import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const toolUseEvent = (name: string, input: Record<string, unknown>) => ({
	type: 'assistant',
	message: { content: [{ type: 'tool_use', name, input }] },
});

test('pipeline tees each invocation stream to agents/stream-*.jsonl without narrating per-event', async () => {
	const dir = setupConsumerRepo();

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, onEvent }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			onEvent?.(toolUseEvent('Edit', { file_path: `src/${role}.js` }));
			onEvent?.({ type: 'result', result: 'x', is_error: false });

			if (role === 'write-tests') {
				writeFileSync(join(dir, 'test.feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test.feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	const config = await loadConfig({ cwd: dir });
	const progressLines: string[] = [];
	const result = await runImplementPipeline({
		cwd: dir,
		planPath: 'plan.md',
		driver,
		config,
		onProgress: (message) => progressLines.push(message),
	});

	expect(result.ok).toBe(true);

	const agentsDir = join(dir, '.lightsout', 'runs', result.manifest.runId, 'agents');

	expect(existsSync(agentsDir)).toBeTruthy();

	const transcripts = readdirSync(agentsDir).filter((name) => name.startsWith('stream-'));

	// implement transcript exists: ${transcripts.join(', ')}
	expect(transcripts.some((name) => name.includes('implement'))).toBeTruthy();

	const implementTranscript = transcripts.find((name) => name.includes('implement'));
	const events = readFileSync(join(agentsDir, implementTranscript ?? ''), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as Record<string, unknown>);

	// both events landed, in order
	expect(events.length).toBe(2);
	expect(events[0].type).toBe('assistant');
	expect(events[1].type).toBe('result');

	// The full play-by-play belongs on disk, not in the terminal — a working
	// agent fires tools every few seconds and narrating each one drowned the
	// progress stream.
	// no per-tool-call narration:\n${progressLines.join('\n')}
	expect(progressLines.every((line) => !line.includes('Edit'))).toBeTruthy();
});
