import { Framework } from '#src/common/constants/Framework.ts';
import type { ChannelFace } from '#src/features/packs/internal/common/types/ChannelFace.ts';

/** The channels the default pack ships, by the names a reader knows them by. `base` is the TypeScript rules every repo gets. */
const knownChannels: Record<string, ChannelFace> = {
	base: { name: 'TypeScript', framework: Framework.TypeScript, activation: 'Always on' },
	react: { name: 'React', framework: Framework.React, activation: 'On with React' },
	tanstack: { name: 'TanStack', framework: Framework.TanStack, activation: 'On with TanStack' },
};

interface Params {
	channel: string;
}

/**
 * How one set of rules is shown. A channel a pack of someone's own declares is
 * named from its id, since nothing here knows it better.
 *
 * @param channel - the channel id, as a pack's documents declare it
 */
export const describeChannel = ({ channel }: Params): ChannelFace => {
	const name = channel.charAt(0).toUpperCase() + channel.slice(1);

	return knownChannels[channel] ?? { name, activation: `On with ${name}` };
};
