---
summary: "business logic returning from several branches instead of once at the end"
checked: false
severity: advisory
---

## Single Return Point

Business logic uses a single return at the end — one consistent place to find the result, and a shared post-step (a floor, a wrapper, a log) gets written once instead of repeated per branch, where one branch inevitably forgets it. **Exception:** guard clauses at the top may return early for validation/null checks.

```typescript
export const calculateShippingCost = ({ weightKg, isExpress, destination }: Params): number => {
	let cost = weightKg * destination.ratePerKg;

	if (isExpress) {
		cost += destination.expressSurcharge;
	}

	// Minimum-charge floor applies to every path — single return writes it once.
	if (cost < destination.minimumCharge) {
		cost = destination.minimumCharge;
	}

	return cost;
};
```
