interface Params {
	/** API-equivalent cost in US dollars, as the agent ledger records it. */
	usd: number;
}

/** A run's cost as '$1.23' — two decimals, because that is the resolution the ledger reports. */
export const formatCost = ({ usd }: Params): string => `$${usd.toFixed(2)}`;
