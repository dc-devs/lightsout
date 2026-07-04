import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { TraverseMode, type ConnectionDoc, type TraceState } from '@lightsout/contracts';
import { draftConnectionDocs, readConnectionMap, renderTrace, verifyConnectionAnchors } from '../src/index';

const commit = (dir: string) => {
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm change', { cwd: dir });

	return execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
};

const setupVerifyFixture = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-verify-'));
	const workspaceDir = mkdtempSync(join(tmpdir(), 'lightsout-verify-ws-'));
	const repo = mkdtempSync(join(tmpdir(), 'lightsout-verify-repo-'));

	mkdirSync(join(repo, 'src/routes'), { recursive: true });
	writeFileSync(join(repo, 'src/routes/evt.ts'), "router.post('/evt', handle);\n");
	execSync('git init -q', { cwd: repo });

	const sha = commit(repo);
	const connections = join(cwd, '.lightsout/connections');

	mkdirSync(connections, { recursive: true });
	writeFileSync(join(connections, 'repos.yaml'), `node-b: ${repo}\n`);
	writeFileSync(
		join(connections, 'node-a--node-b--evt.md'),
		[
			'---',
			'from: node-a',
			'to: node-b',
			'type: http',
			'to-anchor:',
			'  path: src/routes/evt.ts',
			`  pattern: "router.post('/evt'"`,
			'---',
			'',
			'# Summary',
			'',
			'a to b',
		].join('\n'),
	);

	return { cwd, workspaceDir, repo, sha, connections };
};

test('verifyConnectionAnchors: ok advances the sha on repair, then the sha gate short-circuits; drift is found repo-wide and repaired; missing is reported, never deleted', async () => {
	const { cwd, workspaceDir, repo, connections } = setupVerifyFixture();

	const first = await verifyConnectionAnchors({ cwd, connectionsDir: '.lightsout/connections', repair: true, workspaceDir });

	assert.deepEqual(
		first.map((entry) => [entry.side, entry.status]),
		[['to', 'ok']],
		'from side has no anchor (non-repo sender) — only the to anchor verifies',
	);
	assert.ok(readFileSync(join(connections, 'node-a--node-b--evt.md'), 'utf8').includes('last-verified-sha'), 'repair recorded the verified sha');

	const second = await verifyConnectionAnchors({ cwd, connectionsDir: '.lightsout/connections', workspaceDir });

	assert.deepEqual(second.map((entry) => entry.status), ['current'], 'unchanged HEAD short-circuits — one ls-remote, no grep (T9)');

	// The handler moves to a new file: drift, found repo-wide, repaired.
	rmSync(join(repo, 'src/routes/evt.ts'));
	writeFileSync(join(repo, 'src/routes/events.ts'), "router.post('/evt', handleRenamed);\n");
	commit(repo);

	const third = await verifyConnectionAnchors({ cwd, connectionsDir: '.lightsout/connections', repair: true, workspaceDir });

	assert.equal(third[0]?.status, 'drifted');
	assert.match(third[0]?.foundAt ?? '', /src\/routes\/events\.ts:1/);

	const repaired = await readConnectionMap({ connectionsDir: connections });

	assert.equal(repaired.get('node-a--node-b--evt')?.toAnchor?.path, 'src/routes/events.ts', 'the anchor now points where the code actually is');

	// The endpoint disappears entirely: missing — reported for a human.
	rmSync(join(repo, 'src/routes/events.ts'));
	writeFileSync(join(repo, 'src/routes/other.ts'), 'router.get("/other", noop);\n');
	commit(repo);

	const fourth = await verifyConnectionAnchors({ cwd, connectionsDir: '.lightsout/connections', repair: true, workspaceDir });

	assert.equal(fourth[0]?.status, 'missing');
	assert.ok(existsSync(join(connections, 'node-a--node-b--evt.md')), 'a missing anchor never deletes the doc');
});

test('renderTrace: diagram, doc, and plan derive mechanically from the trace — nothing invented', () => {
	const edges = new Map<string, ConnectionDoc>([
		[
			'node-a--node-b--evt',
			{
				from: 'node-a',
				to: 'node-b',
				type: 'http',
				fromAnchor: { path: 'src/send.ts', pattern: '/evt' },
				toAnchor: { path: 'src/routes/evt.ts', pattern: "router.post('/evt'" },
				schema: { from: 'src/types/Event.ts', to: 'src/contracts/event.ts' },
				lastVerifiedSha: undefined,
				additionalContext: [],
			},
		],
	]);
	const state: TraceState = {
		question: 'where does the event go?',
		mode: TraverseMode.Diagram,
		dataOfInterest: 'the event',
		budget: { maxHops: 12, used: 1 },
		frontier: [],
		visited: ['node-a--node-b--evt'],
		hops: [
			{
				edge: 'node-a--node-b--evt',
				node: 'node-b',
				report: {
					node: 'node-b',
					anchorCheck: { status: 'ok', foundAt: null },
					entry: 'handler src/routes/evt.ts:3',
					transforms: [{ at: 'src/enrich.ts:7', what: 'adds geo fields' }],
					exits: [{ kind: 'message-bus', target: 'events-stream', at: 'src/publish.ts:4', carries: 'enriched event', conditional: null, relevant: 'yes' }],
					answerContribution: 'node-b enriches and republishes the event',
					gaps: [],
					confidence: 'solid',
				},
			},
		],
		gaps: [{ node: 'node-b', detail: 'no doc for events-stream', exit: { kind: 'message-bus', target: 'events-stream', at: 'src/publish.ts:4', carries: 'enriched event' } }],
		drift: [],
		answer: null,
	};

	const diagram = renderTrace({ state, edges, mode: TraverseMode.Diagram });

	assert.ok(diagram.includes('flowchart LR'), 'mermaid skeleton present');
	assert.ok(diagram.includes('node-a -->|http: evt| node-b'), 'edge derived from the crossed doc, not invented');
	assert.ok(diagram.includes('adds geo fields'), 'transforms annotate the flow');

	const docMode = renderTrace({ state, edges, mode: TraverseMode.Doc });

	assert.ok(docMode.includes('## 1. node-b'));
	assert.ok(docMode.includes('message-bus → events-stream'), 'exits listed with kind and target');

	const plan = renderTrace({ state, edges, mode: TraverseMode.Plan });

	assert.ok(plan.includes('`src/enrich.ts`'), 'files on the trail cited from the trace');
	assert.ok(plan.includes('src/contracts/event.ts'), 'contract change gated by the edge schema pointers');
});

test('draftConnectionDocs: gaps with concrete exits become drafts/ scaffolds invisible to the map reader', async () => {
	const { cwd, connections } = setupVerifyFixture();
	const runDir = join(cwd, '.lightsout/traverse/2026-07-05-testrun');

	mkdirSync(runDir, { recursive: true });
	writeFileSync(
		join(runDir, 'trace.json'),
		JSON.stringify({
			question: 'q',
			mode: 'answer',
			dataOfInterest: 'q',
			budget: { maxHops: 12, used: 1 },
			frontier: [],
			visited: [],
			hops: [],
			gaps: [
				{ node: 'node-b', detail: 'unmapped edge', exit: { kind: 'message-bus', target: 'events-stream', at: 'src/publish.ts:4', carries: 'enriched event' } },
				{ node: 'node-b', detail: 'a gap with no exit — not draftable' },
			],
			drift: [],
			answer: null,
		}),
	);

	const { drafted, draftsDir } = await draftConnectionDocs({ cwd, connectionsDir: '.lightsout/connections', traverseRunId: '2026-07-05-testrun' });

	assert.deepEqual(drafted, ['node-b--UNKNOWN--events-stream']);

	const draft = readFileSync(join(draftsDir, 'node-b--UNKNOWN--events-stream.md'), 'utf8');

	assert.ok(draft.includes('from: node-b'));
	assert.ok(draft.includes('to: UNKNOWN'), 'the to-side is explicitly the human blank');

	const map = await readConnectionMap({ connectionsDir: connections });

	assert.ok(!map.has('node-b--UNKNOWN--events-stream'), 'drafts never route traversals');
});
