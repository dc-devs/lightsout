import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { readGitPrimaryCheckout } from '#src/common/git/readGitPrimaryCheckout.ts';

interface Params {
	/** The directory the command runs in — the repository root, or a linked worktree of it. */
	cwd: string;
}

/**
 * The `.env` this command reads: `<cwd>/.env` when it exists, otherwise the
 * primary checkout's when `cwd` is a linked worktree, otherwise nothing.
 *
 * A worktree is a fresh checkout and `.env` is gitignored, so the file the
 * user wrote is in the primary checkout and nowhere else — and a command run
 * from inside a worktree, which is where the queue and the ship step do their
 * work, would otherwise report the tracker key missing with the key sitting one
 * directory up. A worktree that carries its own file keeps it: the nearest
 * file wins, and only one is ever read.
 */
const resolveEnvFilePath = async ({ cwd }: Params): Promise<string | undefined> => {
	const own = join(cwd, '.env');

	if (existsSync(own)) {
		return own;
	}

	const primary = await readGitPrimaryCheckout({ cwd });
	const shared = primary === undefined ? undefined : join(primary, '.env');

	return shared !== undefined && shared !== own && existsSync(shared) ? shared : undefined;
};

/**
 * Load the repository's `.env` into the process environment before any command
 * reads it, so a repository can keep its tracker credentials in the file it
 * already gitignores instead of every caller having to export them first.
 * Which file that is — the checkout's own, or the primary checkout's from
 * inside a linked worktree — is `resolveEnvFilePath`'s to say.
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
export const loadRepoEnvFile = async ({ cwd }: Params): Promise<void> => {
	const envFilePath = await resolveEnvFilePath({ cwd });

	if (envFilePath === undefined) {
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
