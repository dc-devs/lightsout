import { spawn } from 'node:child_process';
import { join } from 'node:path';

// The CLI has no in-process seam (process.exit + hard-wired getDriver), so the
// e2e suites run it as a subprocess and pin EXACT stdout/stderr/exit. The bundle
// under test is built from CURRENT source by the e2e config's globalSetup
// (.test-dist/cli-under-test.mjs), never the committed plugin bundle.
const cliPath = join(process.cwd(), '.test-dist', 'cli-under-test.mjs');

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
