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
