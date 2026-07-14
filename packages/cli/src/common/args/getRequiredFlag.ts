import { usage } from '../constants/usage';
import { getStringFlag } from './getStringFlag';

interface Params {
	flags: Map<string, string | true>;
	name: string;
}

/**
 * A flag the command cannot run without. Missing one is a usage error, not an
 * exceptional condition — the CLI's uniform response is the usage text on
 * stderr and exit 1, so this never returns for an absent flag.
 */
export const getRequiredFlag = ({ flags, name }: Params): string => {
	const value = getStringFlag({ flags, name });

	if (!value) {
		console.error(usage);
		process.exit(1);
	}

	return value;
};
