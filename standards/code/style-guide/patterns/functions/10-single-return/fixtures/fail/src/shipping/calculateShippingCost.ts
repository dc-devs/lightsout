interface Params {
	weightKg: number;
	isExpress: boolean;
	destination: { ratePerKg: number; expressSurcharge: number; minimumCharge: number };
}

// A return per branch, so the minimum-charge floor has to be remembered three
// times — and the express branch is where it was forgotten.
export const calculateShippingCost = ({ weightKg, isExpress, destination }: Params): number => {
	if (isExpress) {
		return weightKg * destination.ratePerKg + destination.expressSurcharge;
	}

	if (weightKg * destination.ratePerKg < destination.minimumCharge) {
		return destination.minimumCharge;
	}

	return weightKg * destination.ratePerKg;
};
