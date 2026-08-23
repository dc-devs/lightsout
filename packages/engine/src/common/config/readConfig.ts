import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LightsoutConfig } from '#src/contracts/index.ts';

interface Params {
	cwd: string;
}

/**
 * A validation failure as lines someone can act on.
 *
 * Zod's own `message` is a JSON dump of its issue array, so the sentence the
 * schema author wrote — "unknown scoped gate 'format' — package-gates are
 * check, test, …" — arrives buried in punctuation. The schemas in
 * `#src/contracts` spend real care on those sentences; this is what lets a
 * reader see one.
 */
const describeIssues = ({ issues, configPath }: { issues: { path?: unknown[]; message?: string }[]; configPath: string }) => {
	const lines = issues.map((issue) => {
		const where = (issue.path ?? []).join('.');

		return `  ${where === '' ? '' : `${where}: `}${issue.message ?? 'invalid'}`;
	});

	return [`lightsout.config.json at ${configPath} is not valid:`, ...lines].join('\n');
};

/**
 * Parse the raw file, reporting a failure as something readable.
 *
 * A syntax error stays a `SyntaxError`, because which of the two went wrong is
 * worth keeping: an unparseable file is a typo, an invalid one is a config that
 * means something the engine will not do.
 */
const parseConfig = ({ raw, configPath }: { raw: string; configPath: string }): LightsoutConfig => {
	try {
		return LightsoutConfig.parse(JSON.parse(raw));
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new SyntaxError(`lightsout.config.json at ${configPath} is not valid JSON — ${error.message}`);
		}

		const issues = (error as { issues?: { path?: unknown[]; message?: string }[] }).issues;

		if (issues === undefined) {
			throw error;
		}

		throw new Error(describeIssues({ issues, configPath }));
	}
};

/** The file simply not being there, as opposed to unreadable or unparseable. */
const isMissing = ({ error }: { error: unknown }) => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

/** Read the raw file, or `undefined` when the repo has no config at all. */
const readRaw = async ({ configPath }: { configPath: string }) => {
	try {
		return await readFile(configPath, 'utf8');
	} catch (error) {
		if (isMissing({ error })) {
			return undefined;
		}

		throw new Error(`lightsout.config.json at ${configPath} could not be read — ${(error as Error).message}`);
	}
};

/**
 * Read and validate `lightsout.config.json` from the target repo root — the
 * single coupling point between engine and consumer. A missing or invalid
 * config is a hard error before any run is created.
 */
export const readConfig = async ({ cwd }: Params): Promise<LightsoutConfig> => {
	const configPath = join(cwd, 'lightsout.config.json');
	const raw = await readRaw({ configPath });

	if (raw === undefined) {
		throw new Error(`lightsout.config.json not found at ${configPath}`);
	}

	return parseConfig({ raw, configPath });
};

/**
 * The config when the repo has one, `undefined` when it has none — and a throw
 * when it has one that does not parse.
 *
 * That third case is the point. Commands that can run without a config used to
 * spell this `readConfig(...).catch(() => undefined)`, which cannot tell "this
 * repo has no config" from "this repo's config is broken" and answered both
 * with the defaults. Measured on this repo: one illegal `package-gates` key
 * that `doctor` refused by name took `standards-check` from 790 source files to
 * 909 — the `generated` list was gone, so the web app's generated route tree
 * was read as source — and from 3 blocking findings to 10, with nothing in the
 * output saying the config had been ignored. It read as a code regression and
 * took a bisect of the config to find.
 *
 * A repo with no config gets defaults nobody has to choose. A repo with a
 * broken one gets told.
 */
export const readOptionalConfig = async ({ cwd }: Params): Promise<LightsoutConfig | undefined> => {
	const configPath = join(cwd, 'lightsout.config.json');
	const raw = await readRaw({ configPath });

	if (raw === undefined) {
		return undefined;
	}

	return parseConfig({ raw, configPath });
};
