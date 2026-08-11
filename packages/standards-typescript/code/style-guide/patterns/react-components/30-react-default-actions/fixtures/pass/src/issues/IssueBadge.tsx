import { getBadgeClassName } from './common/utils/getBadgeClassName';

interface Props {
	state: string;
	compact: boolean;
}

// The repeated class logic is named once and shared; the component says what it
// renders.
export const IssueBadge = ({ state, compact }: Props) => <span className={getBadgeClassName({ state, compact })}>{state}</span>;
