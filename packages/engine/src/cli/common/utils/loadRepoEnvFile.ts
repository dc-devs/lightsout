import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

interface Params {
	/** The directory the command runs in, which is the repository root in every ordinary invocation. */
	cwd: string;
}

/**
 * Load `<cwd>/.env` into the process environment before any command reads it,
 * so a repository can keep its tracker credentials in the file it already
 * gitignores instead of every caller having to export them first.
 *
 * The merge is written out rather than delegated to `process.loadEnvFile`,
 * which does the same job. That function writes straight into the real
 * environment block, which a test running inside a worker cannot observe, so
 * the rule that matters most here — the environment wins over the file — would
 * be the one thing no test could prove. `parseEnv` is the same parser without
 * the side effect.
 *
 * A variable already set therefore keeps its value: an exported key, a CI
 * secret and a `--env-file` on the command line all still take precedence over
 * the file. An absent file is not a problem to report — most repositories have
 * none, and every command has to run without one.
 *
 * A file that exists but cannot be read is the different case: the user wrote
 * it and expects it to count, so the reason is printed and the command carries
 * on. Failing the run instead would turn a stray quote in an unrelated
 * variable into an outage, while staying silent would leave the user reading
 * "the tracker API key is missing" with the key sitting in front of them.
 */
export const loadRepoEnvFile = ({ cwd }: Params): void => {
	const envFilePath = join(cwd, '.env');

	if (!existsSync(envFilePath)) {
		return;
	}

	try {
		for (const [name, value] of Object.entries(parseEnv(readFileSync(envFilePath, 'utf8')))) {
			process.env[name] ??= value;
		}
	} catch (error) {
		console.error(`lightsout: ignored ${envFilePath}: ${error instanceof Error ? error.message : String(error)}`);
	}
};
