import type { CustomerTier } from '../common/types/CustomerTier';

// The shared piece — a type — moved to a third module both sides import, so the
// arrows point one way.
export const getOrderTotal = ({ amount, tier }: { amount: number; tier: CustomerTier }): number => amount * (tier === 'gold' ? 0.9 : 1);
