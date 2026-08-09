interface Params {
	weightKg: number;
	isExpress: boolean;
	destination: { ratePerKg: number; expressSurcharge: number; minimumCharge: number };
}

// One exit, so the floor is written once and applies to every path.
export const calculateShippingCost = ({ weightKg, isExpress, destination }: Params): number => {
	let cost = weightKg * destination.ratePerKg;

	if (isExpress) {
		cost += destination.expressSurcharge;
	}

	if (cost < destination.minimumCharge) {
		cost = destination.minimumCharge;
	}

	return cost;
};
