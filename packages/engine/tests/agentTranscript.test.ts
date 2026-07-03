import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@lightsout/drivers';
import { describeAgentEvent } from '../src/describeAgentEvent';
import { loadConfig, runImplementPipeline } from '../src/index';
import { report } from './helpers/report';
import { roleOf } from './helpers/roleOf';
import { setupConsumerRepo } from './helpers/setupConsumerRepo';

const toolUseEvent = (name: string, input: Record<string, unknown>) => ({
	type: 'assistant',
	message: { content: [{ type: 'tool_use', name, input }] },
});

test('describeAgentEvent narrates tool calls and ignores everything else', () => {
	assert.equal(describeAgentEvent({ event: toolUseEvent('Edit', { file_path: 'src/a.ts' }) }), 'Edit: src/a.ts');
	assert.equal(describeAgentEvent({ event: toolUseEvent('Bash', { command: 'pnpm run generate' }) }), 'Bash: pnpm run generate');
	assert.equal(describeAgentEvent({ event: toolUseEvent('TodoWrite', {}) }), 'TodoWrite');
	assert.equal(
		describeAgentEvent({ event: toolUseEvent('Bash', { command: `x${'y'.repeat(200)}` }) })?.length,
		'Bash: '.length + 90,
		'targets truncate',
	);

	assert.equal(describeAgentEvent({ event: { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } } }), undefined);
	assert.equal(describeAgentEvent({ event: { type: 'system', subtype: 'estimated_tokens' } }), undefined);
	assert.equal(describeAgentEvent({ event: 'garbage' }), undefined);
});

test('pipeline tees each invocation stream to agents/stream-*.jsonl and narrates tool calls', async () => {
	const dir = setupConsumerRepo();

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, onEvent }) => {
			const role = roleOf(prompt);

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

	assert.equal(result.ok, true);

	const agentsDir = join(dir, '.lightsout', 'runs', result.manifest.runId, 'agents');

	assert.ok(existsSync(agentsDir));

	const transcripts = readdirSync(agentsDir).filter((name) => name.startsWith('stream-'));

	assert.ok(
		transcripts.some((name) => name.includes('implement')),
		`implement transcript exists: ${transcripts.join(', ')}`,
	);

	const implementTranscript = transcripts.find((name) => name.includes('implement'));
	const events = readFileSync(join(agentsDir, implementTranscript ?? ''), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as Record<string, unknown>);

	assert.equal(events.length, 2, 'both events landed, in order');
	assert.equal(events[0].type, 'assistant');
	assert.equal(events[1].type, 'result');

	assert.ok(
		progressLines.some((line) => line.includes('implement · Edit: src/implement.js')),
		`tool call narrated:\n${progressLines.join('\n')}`,
	);
});
