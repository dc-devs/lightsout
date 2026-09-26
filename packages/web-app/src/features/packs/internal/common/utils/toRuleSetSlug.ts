import { baseRuleSetSlug } from '#src/features/packs/internal/common/constants/baseRuleSetSlug.ts';

interface Params {
	channel: string;
}

/**
 * The address word for a set of rules — the channel's own id, except `base`,
 * which a reader knows as TypeScript.
 *
 * @param channel - the channel id
 */
export const toRuleSetSlug = ({ channel }: Params): string => (channel === 'base' ? baseRuleSetSlug : channel);
