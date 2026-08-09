import type { CustomerTier } from '../common/types/CustomerTier';

export const getCustomerTier = ({ lifetimeCents }: { lifetimeCents: number }): CustomerTier => (lifetimeCents > 100_000 ? 'gold' : 'standard');
