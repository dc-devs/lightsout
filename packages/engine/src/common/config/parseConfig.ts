import { z } from 'zod';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { LightsoutConfig } from '#src/contracts/index.ts';

interface Params {
	raw: string;
	configPath: string;
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
const describeIssues = ({ error, configPath }: { error: z.ZodError; configPath: string }) => {
	const lines = error.issues.map((issue) => {
		const where = issue.path.join('.');

		return `  ${where === '' ? '' : `${where}: `}${issue.message}`;
	});

	return [`lightsout.config.json at ${configPath} is not valid:`, ...lines].join('\n');
};

/**
 * Parse the raw config text, reporting a failure as something readable.
 *
 * A syntax error stays a `SyntaxError`, because which of the two went wrong is
 * worth keeping: an unparseable file is a typo, an invalid one is a config that
 * means something the engine will not do.
 */
export const parseConfig = ({ raw, configPath }: Params): LightsoutConfig => {
	try {
		return LightsoutConfig.parse(JSON.parse(raw));
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new SyntaxError(`lightsout.config.json at ${configPath} is not valid JSON — ${messageOf({ error })}`);
		}

		throw error instanceof z.ZodError ? new Error(describeIssues({ error, configPath })) : error;
	}
};
