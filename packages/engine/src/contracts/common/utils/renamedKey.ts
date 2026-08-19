import { z } from 'zod';

interface Params {
	/** The spelling a config may still carry. */
	from: string;
	/** The key that holds its value now. */
	to: string;
}

/**
 * A config key that no longer exists, declared under its old name so a stale
 * config fails parsing with the new name in the message. The config objects
 * are not strict — an unknown key is stripped — so without this an old
 * spelling would be discarded silently, and the setting it carried would
 * quietly stop applying.
 */
export const renamedKey = ({ from, to }: Params): z.ZodOptional<z.ZodNever> => z.never(`\`${from}\` was renamed to \`${to}\``).optional();
