import { getOrderTotal } from '../orders/getOrderTotal';

export const getCustomerTier = ({ customerId }: { customerId: string }): string =>
	getOrderTotal({ amount: 100, customerId }) > 90 ? 'standard' : 'gold';
