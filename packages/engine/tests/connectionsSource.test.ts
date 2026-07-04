import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConnectionsSource, resolveConnectionsSource } from '../src/index';

test('parseConnectionsSource: local paths, git URLs, and every subpath form', () => {
	assert.deepEqual(parseConnectionsSource({ source: '.lightsout/connections' }), { kind: 'local', path: '.lightsout/connections' });
	assert.deepEqual(parseConnectionsSource({ source: '/abs/map' }), { kind: 'local', path: '/abs/map' });

	assert.deepEqual(parseConnectionsSource({ source: 'git@github.com:org/data-flow-map.git' }), {
		kind: 'git',
		repo: 'git@github.com:org/data-flow-map.git',
		subpath: undefined,
	});
	assert.deepEqual(
		parseConnectionsSource({ source: 'git@github.com:org/repo.git/src/connections' }),
		{ kind: 'git', repo: 'git@github.com:org/repo.git', subpath: 'src/connections' },
		'.git/ is the explicit delimiter',
	);
	assert.deepEqual(
		parseConnectionsSource({ source: 'git@github.com:org/data-flow-map/src/connections' }),
		{ kind: 'git', repo: 'git@github.com:org/data-flow-map', subpath: 'src/connections' },
		'bare scp form: first two segments are the repo, the rest the folder',
	);
	assert.deepEqual(
		parseConnectionsSource({ source: 'https://github.com/org/repo//src/connections' }),
		{ kind: 'git', repo: 'https://github.com/org/repo', subpath: 'src/connections' },
		'// separator survives the protocol slashes',
	);
	assert.deepEqual(
		parseConnectionsSource({ source: 'https://github.com/org/repo/src/connections' }),
		{ kind: 'git', repo: 'https://github.com/org/repo', subpath: 'src/connections' },
		'bare https form: host + two segments are the repo',
	);
});

test('resolveConnectionsSource: a git source clones into the workspace and resolves the folder inside it', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-src-'));
	const workspaceDir = mkdtempSync(join(tmpdir(), 'lightsout-src-ws-'));
	const mapRepo = mkdtempSync(join(tmpdir(), 'lightsout-src-map-'));

	mkdirSync(join(mapRepo, 'src/connections'), { recursive: true });
	writeFileSync(join(mapRepo, 'src/connections/repos.yaml'), 'node-a: /nowhere\n');
	execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: mapRepo });

	// A local bare clone named *.git plays the role of the central map repo.
	const bare = join(mkdtempSync(join(tmpdir(), 'lightsout-src-bare-')), 'data-flow-map.git');

	execSync(`git clone -q --bare '${mapRepo}' '${bare}'`);

	const resolved = await resolveConnectionsSource({ cwd, source: `${bare}/src/connections`, workspaceDir });

	assert.equal(resolved.remote, true);
	assert.equal(resolved.repo, bare);
	assert.ok(existsSync(join(resolved.dir, 'repos.yaml')), 'the folder inside the cloned map repo resolved');

	const local = await resolveConnectionsSource({ cwd, source: '.lightsout/connections', workspaceDir });

	assert.equal(local.remote, false);
	assert.equal(local.dir, join(cwd, '.lightsout/connections'));
});
