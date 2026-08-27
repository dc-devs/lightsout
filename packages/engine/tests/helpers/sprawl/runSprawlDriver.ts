import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Params {
	/** A repository from `seedSprawlRepo`, holding a copy of `scripts/`. */
	cwd: string;
	/** ESM source run inside that repository. It must call `report(value)` exactly once; the value comes back parsed. */
	body: string;
}

/**
 * Runs a line of ESM inside a seeded repository and hands back what it
 * reported.
 *
 * The sprawl scripts are ESM `.mjs` at the repo root, which this suite's
 * CommonJS runner cannot import, and two of them work out where the repository
 * is from their own location. Both problems have the same answer: run the
 * script as a real module inside the fixture, exactly as `pnpm build:sprawl`
 * runs it here.
 */
export const runSprawlDriver = <T>({ cwd, body }: Params): T => {
	const driver = join(cwd, 'sprawlDriver.mjs');

	writeFileSync(driver, `const report = (value) => process.stdout.write(JSON.stringify(value));\n${body}\n`);

	return JSON.parse(execFileSync('node', [driver], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as T;
};
