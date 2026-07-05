import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@lightsout/drivers';
import { runDebug } from '../src/index';

const setupNodeRepo = ({ name, files }: { name: string; files: Record<string, string> }) => {
	const dir = mkdtempSync(join(tmpdir(), `lightsout-dbg-${name}-`));

	for (const [path, content] of Object.entries(files)) {
		mkdirSync(join(dir, path, '..'), { recursive: true });
		writeFileSync(join(dir, path), content);
	}

	execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: dir });

	return dir;
};

/** worker --http /ingest--> api : from-anchor in worker (the emit), to-anchor in api (the handler). */
const ingestDoc = ({ workerAnchor }: { workerAnchor: string }) =>
	[
		'---',
		'from: worker',
		'to: api',
		'type: http',
		'from-anchor:',
		'  path: src/send.ts',
		`  pattern: "${workerAnchor}"`,
		'to-anchor:',
		'  path: src/routes/ingest.ts',
		'  pattern: "router.post(\'/ingest\'"',
		'---',
		'',
		'# Summary',
		'',
		'worker → api (/ingest)',
	].join('\n');

const fixture = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-debug-'));
	const workspaceDir = mkdtempSync(join(tmpdir(), 'lightsout-debug-ws-'));
	const api = setupNodeRepo({ name: 'api', files: { 'src/routes/ingest.ts': "router.post('/ingest', ingest);\n" } });
	const worker = setupNodeRepo({ name: 'worker', files: { 'src/send.ts': "post('/ingest', body);\n" } });
	const connections = join(cwd, '.lightsout/connections');

	mkdirSync(connections, { recursive: true });
	writeFileSync(join(connections, 'repos.yaml'), `api: ${api}\nworker: ${worker}\n`);
	writeFileSync(join(connections, 'worker--api--ingest.md'), ingestDoc({ workerAnchor: "post('/ingest'" }));

	return { cwd, workspaceDir, connections };
};

/** Debug-hop stub keyed by the node named in the prompt. */
const debugDriver = (reports: Record<string, Record<string, unknown>>): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		const node = prompt.match(/- node: (\S+)/)?.[1] ?? 'unknown';
		const report = reports[node];

		if (!report) {
			throw new Error(`no stubbed report for node ${node}`);
		}

		return { text: JSON.stringify({ node, investigation: 'stub', gaps: [], confidence: 'solid', ...report }), exitCode: 0 };
	},
});

const upstreamLead = { verdict: 'points-elsewhere', nextLead: { direction: 'upstream', kind: 'http', target: '/ingest', at: 'src/handler.ts:9', refinedHypothesis: 'check the serializer', why: 'the body was already null on arrival' } };
const rootCause = { verdict: 'root-cause', rootCause: { at: 'src/send.ts:1', explanation: 'serializes an undefined body' }, proposedFix: 'guard the null before post()' };

test('debug: an upstream lead hops to the producer via its from-anchor and halts on the root cause', async () => {
	const { cwd, workspaceDir } = fixture();
	const driver = debugDriver({ api: upstreamLead, worker: rootCause });

	const result = await runDebug({ cwd, driver, symptoms: 'x/y/z', connectionsDir: '.lightsout/connections', start: 'api', workspaceDir });

	assert.equal(result.status, 'resolved', result.error);
	assert.equal(result.state.hops.length, 2, 'seed (api) + one upstream hop (worker), then halt');
	assert.equal(result.state.hops[1]?.node, 'worker');
	assert.equal(result.state.hops[1]?.direction, 'upstream', 'followed the inbound crossing back to its sender');
	assert.equal(result.state.hops[1]?.viaEdge, 'worker--api--ingest');
	assert.deepEqual(
		{ node: result.state.resolution?.node, at: result.state.resolution?.at },
		{ node: 'worker', at: 'src/send.ts:1' },
		'root cause + fix captured in the resolution halt slot',
	);
});

test('debug: a root-cause verdict on the seed halts immediately — one hop, no leads chased', async () => {
	const { cwd, workspaceDir } = fixture();
	const driver = debugDriver({ worker: rootCause });

	const result = await runDebug({ cwd, driver, symptoms: 'x', connectionsDir: '.lightsout/connections', start: 'worker', workspaceDir, budget: 12 });

	assert.equal(result.status, 'resolved');
	assert.equal(result.state.hops.length, 1, 'halted on the seed hop');
	assert.equal(result.state.budget.used, 1, 'did not spend budget past the root cause');
});

test('debug: a lead that matches no connection doc is a gap, not a guess', async () => {
	const { cwd, workspaceDir } = fixture();
	const strayLead = { verdict: 'points-elsewhere', nextLead: { direction: 'downstream', kind: 's3-drop', target: 'unmapped-bucket', at: 'src/x.ts:3', refinedHypothesis: 'h', why: 'w' } };
	const driver = debugDriver({ api: strayLead });

	const result = await runDebug({ cwd, driver, symptoms: 'x', connectionsDir: '.lightsout/connections', start: 'api', workspaceDir });

	assert.equal(result.status, 'unresolved', 'the trail ends unresolved, not guessed');
	assert.equal(result.state.resolution, null);
	assert.equal(result.state.gaps.length, 1);
	assert.match(result.state.gaps[0]?.detail ?? '', /unmapped/);
});

test('debug: budget exhaustion parks the open lead; resume completes it', async () => {
	const { cwd, workspaceDir } = fixture();
	const driver = debugDriver({ api: upstreamLead, worker: rootCause });

	const first = await runDebug({ cwd, driver, symptoms: 'x', connectionsDir: '.lightsout/connections', start: 'api', workspaceDir, budget: 1 });

	assert.equal(first.status, 'budget-exhausted');
	assert.equal(first.state.frontier.length, 1, 'the worker lead is parked on the frontier');
	assert.equal(first.state.frontier[0]?.node, 'worker');

	const resumed = await runDebug({ cwd, driver, symptoms: 'x', connectionsDir: '.lightsout/connections', resumeRunId: first.runId, workspaceDir, budget: 5 });

	assert.equal(resumed.status, 'resolved', resumed.error);
	assert.equal(resumed.state.resolution?.node, 'worker', 'resume picked up the parked lead and found the cause');
});
