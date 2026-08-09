import { getIssueBadgeLabel } from '../../../../../common/utils/getIssueBadgeLabel';

export const IssueBadge = ({ count }: { count: number }) => <span>{getIssueBadgeLabel({ count })}</span>;
