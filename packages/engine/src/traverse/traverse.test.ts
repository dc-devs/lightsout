import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@lightsout/drivers';
import { runTraverse } from '../index';
import { matchExitToEdge, readConnectionMap } from './index';

const hopReport = (overrides: Record<string, unknown>) =>
	JSON.stringify({
		node: 'node-b',
		anchorCheck: { status: 'ok', foundAt: null },
		entry: 'handler src/routes/evt.ts:3',
		transforms: [],
		exits: [],
		answerContribution: 'stub hop',
		gaps: [],
		confidence: 'solid',
		...overrides,
	});

/** A local git repo usable as a clone source. */
const setupNodeRepo = ({ name, files }: { name: string; files: Record<string, string> }) => {
	const dir = mkdtempSync(join(tmpdir(), `lightsout-node-${name}-`));

	for (const [path, content] of Object.entries(files)) {
		mkdirSync(join(dir, path, '..'), { recursive: true });
		writeFileSync(join(dir, path), content);
	}

	execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: dir });

	return dir;
};

const connectionDoc = ({ from, to, type, label, toAnchor }: { from: string; to: string; type: string; label: string; toAnchor?: { path: string; pattern: string } }) =>
	[
		'---',
		`from: ${from}`,
		`to: ${to}`,
		`type: ${type}`,
		'from-anchor:',
		'  path: src/send.ts',
		`  pattern: "${label}"`,
		...(toAnchor ? ['to-anchor:', `  path: ${toAnchor.path}`, `  pattern: "${toAnchor.pattern}"`] : []),
		'---',
		'',
		'# Summary',
		'',
		`${from} → ${to} (${label})`,
	].join('\n');

/** cwd + connections map wired to real local node repos. */
const setupTraverseFixture = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-traverse-'));
	const workspaceDir = mkdtempSync(join(tmpdir(), 'lightsout-traverse-ws-'));
	const nodeB = setupNodeRepo({ name: 'b', files: { 'src/routes/evt.ts': "router.post('/evt', handle);\n" } });
	const nodeC = setupNodeRepo({ name: 'c', files: { 'src/routes/relay.ts': "router.post('/relay', ingest);\n" } });
	const connections = join(cwd, '.lightsout/connections');

	mkdirSync(connections, { recursive: true });
	writeFileSync(join(connections, 'repos.yaml'), `node-b: ${nodeB}\nnode-c: ${nodeC}\n`);
	writeFileSync(
		join(connections, 'node-a--node-b--evt.md'),
		connectionDoc({ from: 'node-a', to: 'node-b', type: 'http', label: '/evt', toAnchor: { path: 'src/routes/evt.ts', pattern: "router.post('/evt'" } }),
	);
	writeFileSync(
		join(connections, 'node-b--node-c--relay.md'),
		connectionDoc({ from: 'node-b', to: 'node-c', type: 'http', label: '/relay', toAnchor: { path: 'src/routes/relay.ts', pattern: "router.post('/relay'" } }),
	);

	return { cwd, workspaceDir, connections };
};

/** Hop stub keyed by the node named in the prompt. */
const hopDriver = (reports: Record<string, string>): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		const node = prompt.match(/- node: (\S+)/)?.[1] ?? 'unknown';
		const text = reports[node];

		if (!text) {
			throw new Error(`no stubbed report for node ${node}`);
		}

		return { text, exitCode: 0 };
	},
});

test('traverse: worklist loop follows matched exits, records gaps and drift, never re-enqueues visited edges', async () => {
	const { cwd, workspaceDir } = setupTraverseFixture();
	const driver = hopDriver({
		'node-b': hopReport({
			node: 'node-b',
			anchorCheck: { status: 'drifted', foundAt: 'src/routes/evt.ts:9' },
			exits: [
				{ kind: 'http', target: 'POST /relay', at: 'src/send.ts:5', carries: 'the event', conditional: null, relevant: 'yes' },
				{ kind: 'message-bus', target: 'mystery-stream', at: 'src/send.ts:9', carries: 'a copy', conditional: null, relevant: 'unsure' },
				{ kind: 'http', target: 'https://metrics.example.com', at: 'src/send.ts:12', carries: 'nothing of interest', conditional: null, relevant: 'no' },
			],
		}),
		'node-c': hopReport({
			node: 'node-c',
			// Exit back toward node-b: its edge is already visited — the visited set terminates the cycle.
			exits: [{ kind: 'http', target: 'POST /evt', at: 'src/reply.ts:2', carries: 'ack loop', conditional: null, relevant: 'yes' }],
		}),
	});

	const progress: string[] = [];
	const result = await runTraverse({
		cwd,
		driver,
		question: 'where does the event go?',
		connectionsDir: '.lightsout/connections',
		start: 'node-a--node-b--evt',
		workspaceDir,
		onProgress: (message) => progress.push(message),
	});

	assert.equal(result.status, 'complete', result.error);
	assert.deepEqual(
		result.state.hops.map((hop) => hop.node),
		['node-b', 'node-c'],
		'the matched exit was followed exactly once',
	);
	assert.deepEqual(result.state.visited, ['node-a--node-b--evt', 'node-b--node-c--relay']);
	assert.equal(result.state.budget.used, 2);

	const gapTargets = result.state.gaps.map((gap) => gap.exit?.target);

	assert.ok(gapTargets.includes('mystery-stream'), 'unmapped exit recorded as a GAP, not guessed at');
	assert.ok(!gapTargets.includes('https://metrics.example.com'), 'relevant:no exits are dropped, not gapped');
	assert.deepEqual(result.state.drift, [{ edge: 'node-a--node-b--evt', node: 'node-b', status: 'drifted', foundAt: 'src/routes/evt.ts:9' }]);
	assert.ok(existsSync(join(result.runDir, 'trace.json')), 'trace persisted');
	assert.ok(progress.some((line) => line.includes('hop 1/12')), 'hops narrated with budget');

	// node-c's exit points back at node-b's inbound edge (kind+target match
	// node-a--node-b--evt is from node-a, so from-node filtering excludes it —
	// nothing to re-enqueue and the loop terminated with an empty frontier).
	assert.equal(result.state.frontier.length, 0);
});

test('traverse: budget exhaustion parks the frontier; resume continues from it', async () => {
	const { cwd, workspaceDir } = setupTraverseFixture();
	const driver = hopDriver({
		'node-b': hopReport({
			node: 'node-b',
			exits: [{ kind: 'http', target: 'POST /relay', at: 'src/send.ts:5', carries: 'the event', conditional: null, relevant: 'yes' }],
		}),
		'node-c': hopReport({ node: 'node-c' }),
	});

	const first = await runTraverse({
		cwd,
		driver,
		question: 'where does the event go?',
		connectionsDir: '.lightsout/connections',
		start: 'node-a--node-b--evt',
		budget: 1,
		workspaceDir,
	});

	assert.equal(first.status, 'budget-exhausted');
	assert.equal(first.state.hops.length, 1);
	assert.deepEqual(
		first.state.frontier.map((entry) => entry.edge),
		['node-b--node-c--relay'],
		'the unfollowed edge waits on the frontier',
	);

	const resumed = await runTraverse({
		cwd,
		driver,
		question: 'where does the event go?',
		connectionsDir: '.lightsout/connections',
		resumeRunId: first.runId,
		workspaceDir,
	});

	assert.equal(resumed.status, 'complete', resumed.error);
	assert.deepEqual(
		resumed.state.hops.map((hop) => hop.node),
		['node-b', 'node-c'],
		'resume continued the same trace instead of restarting',
	);
});

test('traverse: non-repo nodes are crossed mechanically — no agent, no budget', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-traverse-nr-'));
	const workspaceDir = mkdtempSync(join(tmpdir(), 'lightsout-traverse-nr-ws-'));
	const nodeC = setupNodeRepo({ name: 'c2', files: { 'src/feed.ts': 'consume();\n' } });
	const connections = join(cwd, '.lightsout/connections');

	mkdirSync(connections, { recursive: true });
	writeFileSync(join(connections, 'repos.yaml'), `node-c: ${nodeC}\n`);
	writeFileSync(join(connections, 'node-a--kinesis--drop.md'), connectionDoc({ from: 'node-a', to: 'kinesis', type: 'message-bus', label: 'events' }));
	writeFileSync(
		join(connections, 'kinesis--node-c--feed.md'),
		connectionDoc({ from: 'kinesis', to: 'node-c', type: 'message-bus', label: 'events', toAnchor: { path: 'src/feed.ts', pattern: 'consume(' } }),
	);

	const driver = hopDriver({ 'node-c': hopReport({ node: 'node-c' }) });
	const result = await runTraverse({
		cwd,
		driver,
		question: 'who consumes the stream?',
		connectionsDir: '.lightsout/connections',
		start: 'node-a--kinesis--drop',
		workspaceDir,
	});

	assert.equal(result.status, 'complete', result.error);
	assert.equal(result.state.budget.used, 1, 'only the repo hop consumed budget');
	assert.equal(result.state.hops[0]?.node, 'kinesis');
	assert.ok(result.state.hops[0]?.note?.includes('non-repo'), 'mechanical crossing recorded');
	assert.equal(result.state.hops[1]?.node, 'node-c');
	assert.ok(result.state.hops[1]?.report, 'downstream repo node got a real hop');
});

test('matchExitToEdge: filters by origin node and kind; ambiguity returns every match', async () => {
	const { cwd } = setupTraverseFixture();
	const edges = await readConnectionMap({ connectionsDir: join(cwd, '.lightsout/connections') });
	const exit = { kind: 'http', target: 'POST /relay', at: 'x:1', carries: 'evt', conditional: null, relevant: 'yes' } as const;

	assert.deepEqual(matchExitToEdge({ exit, node: 'node-b', edges }), ['node-b--node-c--relay']);
	assert.deepEqual(matchExitToEdge({ exit, node: 'node-c', edges }), [], 'origin node filters candidates');
	assert.deepEqual(
		matchExitToEdge({ exit: { ...exit, kind: 'message-bus' }, node: 'node-b', edges }),
		[],
		'kind mismatch never matches',
	);
});
