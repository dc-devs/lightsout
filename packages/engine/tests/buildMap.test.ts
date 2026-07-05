import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { EdgeInventory } from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
import { authorConnectionDocs, joinInventories, readConnectionMap, runBuildMap } from '../src/index';

const inventoryEdge = (overrides: Record<string, unknown>) => ({
	direction: 'out',
	kind: 'http',
	matchKey: '/v2/event',
	at: 'src/send.ts:5',
	pattern: "post('/v2/event')",
	payload: 'telemetry event',
	schemaAt: null,
	conditional: null,
	operations: [],
	noise: false,
	...overrides,
});

const setupRepo = (name: string) => {
	const dir = mkdtempSync(join(tmpdir(), `lightsout-map-${name}-`));

	writeFileSync(join(dir, 'code.ts'), 'export const x = 1;\n');
	execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: dir });

	return { dir, sha: execSync('git rev-parse HEAD', { cwd: dir }).toString().trim() };
};

test('joinInventories: exact and fuzzy pairing, orphans, noise, scanner gaps', () => {
	const inventories = [
		{
			node: 'node-a',
			scannedSha: 'aaa',
			scannedPathSha: null,
			scannerVersion: null,
			edges: [
				inventoryEdge({}),
				inventoryEdge({ matchKey: '/v2/users/{id}', at: 'src/users.ts:8', payload: 'user fetch' }),
				inventoryEdge({ matchKey: 'env:STREAM', kind: 'message-bus', at: 'src/stream.ts:9', payload: 'events' }),
				inventoryEdge({ matchKey: '/health', at: 'src/health.ts:1', noise: true }),
			],
			gaps: [],
		},
		{
			node: 'node-b',
			scannedSha: 'bbb',
			scannedPathSha: null,
			scannerVersion: null,
			edges: [
				inventoryEdge({ direction: 'in', matchKey: '/v2/event/', at: 'src/routes/event.ts:3', pattern: "router.post('/v2/event'" }),
				inventoryEdge({ direction: 'in', matchKey: '/users/:id', at: 'src/routes/users.ts:4', pattern: "router.get('/users/:id'" }),
			],
			gaps: ['dynamic dispatch at src/x.ts — target unresolvable'],
		},
	] as EdgeInventory[];

	const result = joinInventories({ inventories, edges: new Map() });

	assert.equal(result.matched.length, 2);

	const exact = result.matched.find((entry) => entry.matchKey === '/v2/event');
	const fuzzy = result.matched.find((entry) => entry.matchKey !== '/v2/event');

	assert.equal(exact?.fuzzy, false, 'trailing slash is exact-normalized, not fuzzy');
	assert.deepEqual([exact?.from, exact?.to], ['node-a', 'node-b']);
	assert.equal(fuzzy?.fuzzy, true, 'version-prefix + param-name tolerance is flagged for review');
	assert.deepEqual(
		result.orphansOut.map((entry) => entry.matchKey),
		['env:STREAM'],
		'unmatched outbound is an orphan, not a guess',
	);
	assert.equal(result.noise.length, 1, 'noise flagged by scanners is bucketed, never silently dropped');
	assert.deepEqual(result.gaps, [{ node: 'node-b', detail: 'dynamic dispatch at src/x.ts — target unresolvable' }]);
});

test('joinInventories: a multiplexed graphql edge carries verified (both-sighted) operations and flags drift', () => {
	const inventories = [
		{
			node: 'web-app',
			scannedSha: 'aaa',
			scannedPathSha: null,
			scannerVersion: null,
			edges: [
				inventoryEdge({
					kind: 'graphql',
					matchKey: '/graphql',
					direction: 'out',
					at: 'src/common/graphql/client.ts:12',
					payload: 'all queries/mutations',
					operations: [
						{ name: 'signIn', type: 'mutation' },
						// PascalCase op-document name on the client vs camelCase resolver on the server — must still pair.
						{ name: 'FindAllProjects', type: null },
					],
				}),
			],
			gaps: [],
		},
		{
			node: 'backend',
			scannedSha: 'bbb',
			scannedPathSha: null,
			scannerVersion: null,
			edges: [
				inventoryEdge({
					kind: 'graphql',
					matchKey: '/graphql',
					direction: 'in',
					at: 'src/base/app/modules/graphql.module.ts:9',
					pattern: "GraphQLModule.forRoot({ path: '/graphql'",
					operations: [
						{ name: 'findAllProjects', type: 'query' },
						{ name: 'createProject', type: 'mutation' },
					],
				}),
			],
			gaps: [],
		},
	] as EdgeInventory[];

	const result = joinInventories({ inventories, edges: new Map() });
	const edge = result.matched[0];

	assert.equal(result.matched.length, 1, 'one transport edge, not one per operation');
	assert.deepEqual([edge?.from, edge?.to], ['web-app', 'backend']);
	assert.deepEqual(
		edge?.operations.map((op) => op.name),
		['findAllProjects'],
		'operations = sighted on BOTH sides (verified traffic), named from the handler resolver — case-insensitive match',
	);
	assert.equal(edge?.operations[0]?.type, 'query', 'the verified op takes the handler’s canonical type');
	assert.deepEqual(edge?.operationDrift.callerOnly, ['signIn'], 'called but not exposed → drift the reviewer sees');
	assert.equal(edge?.operationDrift.handlerOnlyCount, 1, 'createProject is exposed but never called → unused-surface count');
	assert.deepEqual(result.orphansOut, [], 'no per-operation orphans');
	assert.deepEqual(result.orphansIn, [], 'no per-operation orphans');
});

test('joinInventories: intra-node producer↔consumer self-loops collapse to noise, not orphan-both', () => {
	const inventories = [
		{
			node: 'backend',
			scannedSha: 'aaa',
			scannedPathSha: null,
			scannerVersion: null,
			edges: [
				inventoryEdge({ kind: 'message-bus', matchKey: 'linear-sync', direction: 'out', at: 'src/linear-sync.service.ts:51', payload: 'enqueue' }),
				inventoryEdge({ kind: 'message-bus', matchKey: 'linear-sync', direction: 'in', at: 'src/linear-sync.processor.ts:26', payload: 'consume' }),
				inventoryEdge({ matchKey: '/events', direction: 'out', at: 'src/client.ts:1' }),
			],
			gaps: [],
		},
		{
			node: 'web',
			scannedSha: 'bbb',
			scannedPathSha: null,
			scannerVersion: null,
			edges: [inventoryEdge({ matchKey: '/events', direction: 'in', at: 'src/routes/events.ts:2', pattern: "router.post('/events'" })],
			gaps: [],
		},
	] as EdgeInventory[];

	const result = joinInventories({ inventories, edges: new Map() });

	assert.equal(result.matched.length, 1, 'the genuine cross-node edge still pairs');
	assert.deepEqual([result.matched[0]?.from, result.matched[0]?.to], ['backend', 'web']);
	assert.deepEqual(result.orphansOut, [], 'the self-loop is not left as an orphan-out');
	assert.deepEqual(result.orphansIn, [], 'the self-loop is not left as an orphan-in');
	assert.equal(result.noise.length, 2, 'both ends of the self-loop bucket to noise, preserving the record');
	assert.deepEqual(
		result.noise.map((entry) => entry.direction).sort(),
		['in', 'out'],
		'both directions of the internal loop are recorded',
	);
});

test('build-map: two monorepo packages sharing one repo scan in parallel without racing the clone', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-monomap-'));
	const workspaceDir = mkdtempSync(join(tmpdir(), 'lightsout-monomap-ws-'));
	const mono = mkdtempSync(join(tmpdir(), 'lightsout-monomap-repo-'));

	mkdirSync(join(mono, 'packages/a'), { recursive: true });
	mkdirSync(join(mono, 'packages/b'), { recursive: true });
	writeFileSync(join(mono, 'packages/a/send.ts'), "post('/v2/event')\n");
	writeFileSync(join(mono, 'packages/b/route.ts'), "router.post('/v2/event')\n");
	execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: mono });

	const sha = execSync('git rev-parse HEAD', { cwd: mono }).toString().trim();
	const connections = join(cwd, '.lightsout/connections');

	mkdirSync(connections, { recursive: true });
	writeFileSync(join(connections, 'repos.yaml'), `node-a: { repo: ${mono}, path: packages/a }\nnode-b: { repo: ${mono}, path: packages/b }\n`);

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const node = prompt.match(/- node: (\S+)/)?.[1] ?? 'unknown';
			const direction = node === 'node-a' ? 'out' : 'in';

			return {
				text: JSON.stringify({
					node,
					scannedSha: sha,
					scannedPathSha: sha,
					edges: [inventoryEdge({ direction, at: node === 'node-a' ? 'packages/a/send.ts:1' : 'packages/b/route.ts:1' })],
					gaps: [],
				}),
				exitCode: 0,
			};
		},
	};

	const result = await runBuildMap({ cwd, driver, nodes: ['node-a', 'node-b'], connectionsDir: '.lightsout/connections', workspaceDir });

	assert.equal(result.status, 'complete', result.error);
	assert.equal(result.join?.matched.length, 1, 'wire call between two packages of one repo is a real edge');
});

test('build-map end to end: scan → join → review-gated author → re-run confirms the authored doc', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-buildmap-'));
	const workspaceDir = mkdtempSync(join(tmpdir(), 'lightsout-buildmap-ws-'));
	const nodeA = setupRepo('a');
	const nodeB = setupRepo('b');
	const connections = join(cwd, '.lightsout/connections');

	mkdirSync(connections, { recursive: true });
	writeFileSync(join(connections, 'repos.yaml'), `node-a: ${nodeA.dir}\nnode-b: ${nodeB.dir}\n`);

	let invocations = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			invocations += 1;

			const node = prompt.match(/- node: (\S+)/)?.[1] ?? 'unknown';
			const inventory =
				node === 'node-a'
					? { node, scannedSha: nodeA.sha, scannedPathSha: null, edges: [inventoryEdge({})], gaps: [] }
					: {
							node,
							scannedSha: nodeB.sha,
							scannedPathSha: null,
							edges: [inventoryEdge({ direction: 'in', at: 'src/routes/event.ts:3', pattern: "router.post('/v2/event'" })],
							gaps: [],
						};

			return { text: JSON.stringify(inventory), exitCode: 0 };
		},
	};

	const first = await runBuildMap({ cwd, driver, nodes: ['node-a', 'node-b'], connectionsDir: '.lightsout/connections', workspaceDir });

	assert.equal(first.status, 'complete', first.error);
	assert.equal(first.join?.matched.length, 1, 'both sightings joined into one edge');
	assert.equal(invocations, 2, 'one scan agent per node');
	assert.ok(existsSync(join(first.runDir, 'join.json')), 'the review-gate artifact persisted');
	assert.ok(existsSync(join(cwd, '.lightsout/traverse/inventories/node-a.json')), 'inventories are durable');
	assert.equal((await readConnectionMap({ connectionsDir: connections }).catch(() => new Map())).size, 0, 'REVIEW GATE: no doc written by the scan step');

	// SHA-gated freshness: same nodes again → zero new agent invocations.
	const second = await runBuildMap({ cwd, driver, nodes: ['node-a', 'node-b'], connectionsDir: '.lightsout/connections', workspaceDir });

	assert.equal(invocations, 2, 'current inventories reused without rescanning');
	assert.deepEqual(second.reused.sort(), ['node-a', 'node-b']);

	// Post-review author step (the join is the reviewed artifact).
	assert.ok(first.join);

	const authored = await authorConnectionDocs({
		connectionsDir: connections,
		join: first.join,
		shaByNode: new Map([
			['node-a', nodeA.sha],
			['node-b', nodeB.sha],
		]),
	});

	assert.deepEqual(authored.authored, ['node-a--node-b--v2-event']);

	const map = await readConnectionMap({ connectionsDir: connections });
	const doc = map.get('node-a--node-b--v2-event');

	assert.ok(doc, 'authored doc parses against the ConnectionDoc contract');
	assert.deepEqual(doc?.fromAnchor, { path: 'src/send.ts', pattern: "post('/v2/event')" }, 'anchor comes straight from the code-verified sighting');
	assert.deepEqual(doc?.lastVerifiedSha, { 'node-a': nodeA.sha, 'node-b': nodeB.sha });
	assert.ok(readFileSync(join(connections, 'INDEX.md'), 'utf8').includes('node-a--node-b--v2-event.md'), 'INDEX regenerated');

	// Third run: the authored doc now exists with matching anchors → confirmed, nothing new to author.
	const third = await runBuildMap({ cwd, driver, nodes: ['node-a', 'node-b'], connectionsDir: '.lightsout/connections', workspaceDir });

	assert.equal(third.join?.matched.length, 0, 'the edge is no longer "new"');
	assert.deepEqual(third.join?.confirmed, [{ doc: 'node-a--node-b--v2-event' }], 'the verification sweep is the same join re-run');
});

test('build-map: a scanner-version change invalidates a code-fresh inventory (re-scan, not reuse)', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-scanver-'));
	const workspaceDir = mkdtempSync(join(tmpdir(), 'lightsout-scanver-ws-'));
	const node = setupRepo('n');
	const connections = join(cwd, '.lightsout/connections');

	mkdirSync(connections, { recursive: true });
	writeFileSync(join(connections, 'repos.yaml'), `node-n: ${node.dir}\n`);

	let invocations = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			invocations += 1;

			return { text: JSON.stringify({ node: 'node-n', scannedSha: node.sha, scannedPathSha: null, edges: [inventoryEdge({})], gaps: [] }), exitCode: 0 };
		},
	};
	const run = () => runBuildMap({ cwd, driver, nodes: ['node-n'], connectionsDir: '.lightsout/connections', workspaceDir });
	const inventoryPath = join(cwd, '.lightsout/traverse/inventories/node-n.json');

	await run();
	assert.equal(invocations, 1, 'first run scans');

	const reuse = await run();
	assert.equal(invocations, 1, 'code + scanner unchanged → reused, no new scan');
	assert.deepEqual(reuse.reused, ['node-n']);

	// Same code (same sha), but pretend the inventory came from an older scanner.
	const saved = JSON.parse(readFileSync(inventoryPath, 'utf8'));
	assert.ok(saved.scannerVersion, 'a scanned inventory carries the scanner version');
	writeFileSync(inventoryPath, JSON.stringify({ ...saved, scannerVersion: 'stale-000000' }));

	const after = await run();
	assert.equal(invocations, 2, 'scanner changed → re-scan even though the code sha is unchanged');
	assert.deepEqual(after.scanned, ['node-n']);
	assert.deepEqual(after.reused, [], 'not reused');
});
