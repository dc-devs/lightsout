import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { usage } from '@/cli/common/constants/usage';
import { exitCli } from '@/cli/common/utils/exitCli';

interface Params {
	flags: Map<string, string | true>;
	name: string;
}

/**
 * A flag the command cannot run without. Missing one is a usage error, not an
 * exceptional condition — the CLI's uniform response is the usage text on
 * stderr and exit 1, so this never resolves for an absent flag. Async because
 * the exit drains the stdio pipes first (see exitCli).
 */
export const getRequiredFlag = async ({ flags, name }: Params): Promise<string> => {
	const value = getStringFlag({ flags, name });

	if (!value) {
		console.error(usage);
		return exitCli({ code: 1 });
	}

	return value;
};
