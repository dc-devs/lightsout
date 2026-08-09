import { formatMoney } from '../common/utils/formatMoney';

export const getChargeLabel = ({ cents }: { cents: number }): string => `Charged ${formatMoney({ cents })}`;
