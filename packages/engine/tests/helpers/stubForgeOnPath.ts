import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** What one stubbed `gh` invocation answers with. */
interface ForgeResponse {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
}

interface Params {
	/**
	 * Keyed by a prefix of the arguments after the `gh` word, joined by spaces;
	 * the first key the invocation starts with answers it. An invocation nothing
	 * matches exits 127, so a test that forgot a call fails on that call rather
	 * than on a later assertion.
	 *
	 * A list answers one entry per matching invocation in order, and its last
	 * entry answers every invocation after it — the only way to model a forge
	 * whose answer changes between two identical reads, such as a pull request
	 * head that moves while its checks are being read.
	 *
	 * `__HEAD__` anywhere in a `stdout` is replaced, at call time, with the
	 * commit the checkout is standing on. A pull request's head is the commit the
	 * sequence just pushed, and a fixture cannot know that commit in advance when
	 * the ship itself creates it — a merge commit, a release commit — so the
	 * placeholder is how a forge answers about the candidate rather than about a
	 * commit written down before it existed.
	 */
	responses: Record<string, ForgeResponse | ForgeResponse[]>;
}

/**
 * A fake `gh` at the front of PATH, answering from a table and recording every
 * invocation.
 *
 * Ship's forge module shells out to the real `gh`, so without this a test would
 * ask a real forge about a real pull request — and its verdict would depend on
 * the machine's login rather than on the code. The shared test setup restores
 * PATH after every test, so nothing here has to put it back.
 */
export const stubForgeOnPath = ({ responses }: Params) => {
	const binDir = mkdtempSync(join(tmpdir(), 'lightsout-gh-'));
	const logPath = join(binDir, 'gh.log');
	const script = [
		'#!/usr/bin/env node',
		"const { appendFileSync, readFileSync } = require('node:fs');",
		"const { execSync } = require('node:child_process');",
		`const table = ${JSON.stringify(Object.entries(responses))};`,
		"const args = process.argv.slice(2).join(' ');",
		`appendFileSync(${JSON.stringify(logPath)}, args + '\\n');`,
		'const match = (line) => table.find(([prefix]) => line.startsWith(prefix));',
		'const matched = match(args);',
		// Which turn this invocation is, counted from the log rather than from
		// memory: every call is its own short-lived process, so the file is the
		// only place a count can survive between them.
		`const logged = readFileSync(${JSON.stringify(logPath)}, 'utf8').split('\\n').filter(Boolean);`,
		'const turn = logged.filter((line) => match(line) === matched).length - 1;',
		"const scripted = matched === undefined ? [{ stderr: 'no stub for: ' + args, exitCode: 127 }] : [matched[1]].flat();",
		'const answer = scripted[Math.min(turn, scripted.length - 1)];',
		// Read from git rather than from the table, because the commit a fixture
		// would have to write down is one the ship creates while it runs.
		"const head = () => execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();",
		"const stdout = answer.stdout ?? '';",
		"process.stdout.write(stdout.includes('__HEAD__') ? stdout.split('__HEAD__').join(head()) : stdout);",
		"process.stderr.write(answer.stderr ?? '');",
		// Set rather than forced: process.exit would discard whatever the pipes
		// have not accepted yet, which is the JSON the caller is about to parse.
		'process.exitCode = answer.exitCode ?? 0;',
		'',
	].join('\n');

	writeFileSync(join(binDir, 'gh'), script, { mode: 0o755 });
	process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;

	const readForgeLog = () => {
		try {
			return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
		} catch {
			return [];
		}
	};

	return { readForgeLog };
};
