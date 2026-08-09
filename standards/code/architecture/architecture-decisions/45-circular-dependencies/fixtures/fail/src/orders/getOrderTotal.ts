import { getCustomerTier } from '../customers/getCustomerTier';

// orders imports customers, customers imports orders: fragile load order, and a
// bundler can no longer drop either half.
export const getOrderTotal = ({ amount, customerId }: { amount: number; customerId: string }): number =>
	amount * (getCustomerTier({ customerId }) === 'gold' ? 0.9 : 1);
