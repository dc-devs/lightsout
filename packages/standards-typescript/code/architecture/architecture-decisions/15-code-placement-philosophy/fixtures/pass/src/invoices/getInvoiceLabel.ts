import { formatMoney } from '../common/utils/formatMoney';

export const getInvoiceLabel = ({ cents }: { cents: number }): string => `Invoiced ${formatMoney({ cents })}`;
