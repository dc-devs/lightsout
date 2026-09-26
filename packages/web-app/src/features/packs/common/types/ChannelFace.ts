import type { Framework } from '#src/common/constants/Framework.ts';

/** How a set of rules is shown: the name a reader knows it by, its logo when it has one, and when its rules apply. */
export interface ChannelFace {
	name: string;
	framework?: Framework;
	activation: string;
}
