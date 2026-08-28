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
	 */
	responses: Record<string, ForgeResponse>;
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
		"const { appendFileSync } = require('node:fs');",
		`const table = ${JSON.stringify(Object.entries(responses))};`,
		"const args = process.argv.slice(2).join(' ');",
		`appendFileSync(${JSON.stringify(logPath)}, args + '\\n');`,
		'const matched = table.find(([prefix]) => args.startsWith(prefix));',
		"const answer = matched === undefined ? { stderr: 'no stub for: ' + args, exitCode: 127 } : matched[1];",
		"process.stdout.write(answer.stdout ?? '');",
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
