import { spawn } from 'node:child_process';
import { join } from 'node:path';

// The CLI has no in-process seam (process.exit + hard-wired getDriver), so the
// e2e suites run it as a subprocess and pin EXACT stdout/stderr/exit. The bundle
// under test is built from CURRENT source by the e2e config's globalSetup
// (.test-dist/cli-under-test.mjs), never the committed plugin bundle.
//
// Anchored on this file rather than on the working directory, which depends on
// where the runner was invoked from and would send this looking in the wrong
// place the moment the suite is run from inside its own package. The globalSetup
// that writes the bundle anchors the same way, and the two have to agree.
const cliPath = join(__dirname, '..', '..', '..', '..', '.test-dist', 'cli-under-test.mjs');

interface Params {
	args: string[];
}

/**
 * Run the built CLI as a real subprocess and collect everything it said.
 *
 * @param args - argv after the program name
 */
export const runCli = ({ args }: Params): Promise<{ stdout: string; stderr: string; code: number | null }> =>
	new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cliPath, ...args]);

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', reject);
		child.on('close', (code) => resolve({ stdout, stderr, code }));
	});
