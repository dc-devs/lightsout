# Functions

## Syntax & Style

- Use arrow functions (unless the codebase uses a different convention)
- **If the function has arguments — exported or private — pass an object and destructure:**
    - **Exported functions:** declare an interface called `Params` for the object argument
    - **Private helpers:** use an inline object type (a file with multiple helpers cannot declare multiple `Params` interfaces)
    - **Why objects:** positional signatures decay under growth — params get appended out of order, middle params can never be removed, and same-typed slots transpose silently (`copyFile(dest, src)` compiles). Object args self-document at every call site.
- **No arguments** → no argument object, no `Params` interface.
- **Sole exception — externally imposed signatures:** a shape dictated by another contract is written as that contract demands, never re-declared locally. Two directions: **callback-shaped** (callbacks to `map`/`reduce`/`sort`, event handlers, framework hooks — the caller dictates) and **pass-through forwarders** (a wrapper forwarding one params object unchanged to a single callee — the callee dictates; type it `Parameters<typeof callee>[0]`, since a hand-copied `Params` would be a shadow contract that drifts).
- If callers need to *name* the argument type (e.g., to pre-build a typed args object), it has become public contract — promote it to a named exported type in `types/` in place of `Params`.
- Export the function as a named export on the line it is defined.

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

## One Exported Function Per File — Not Negotiable

Every **exported** function gets its own file, named after the export (cased per [file-naming.md](../conventions/file-naming.md)). Rationalizations that are NOT valid: "closely related", "both config functions", "over-engineered to split", "one is just a helper for the other" — if it's truly a helper, make it **non-exported** and co-locate it; if it's exported, it gets its own file.

```typescript
// ❌ config.ts exporting loadConfig AND saveConfig — split into loadConfig.ts + saveConfig.ts
```

### Private Helpers May Co-Locate

A **non-exported** helper may live in the file of the export it serves when both hold: (1) no `export` keyword, (2) called only from this file. The file acts as a module: the export is the public API, helpers are compiler-enforced internals, covered through the export's tests. **The moment a second file needs the helper, it gets exported — and exported means its own file.** The bright line stays mechanical: `export` keyword → own file.

```typescript
interface Params {
	records: ReportRecord[];
}

// Private helper: inline object type, inferred return
const sumTotals = ({ records }: { records: ReportRecord[] }) => {
	return records.reduce((total, record) => total + record.amount, 0);
};

// Export: Params interface + declared return type
export const buildReportSummary = ({ records }: Params): { total: number } => {
	return { total: sumTotals({ records }) };
};
```

If a helper's branches cannot be reached through the export's inputs, that branch is dead code — delete it. If covering a helper through the export is genuinely impractical (combinatorial inputs), the helper has earned promotion to its own file with its own tests.

## Function Size Limits

| Lines | Assessment |
| ----- | ------------------------------------ |
| <=50  | Fine |
| 50-80 | Review — look for extractable logic |
| 80+   | Needs splitting |

Files stay under ~250 lines (~300 for `.tsx` — JSX and props interfaces earn the slack) — approaching the cap signals a split or graduation. React components and hooks have their own thresholds (see the react patterns doc when it applies).

**Exception — orchestration functions** may exceed 50 lines when each step delegates to a dedicated function (no inline business logic) and the flow is linear: a 150-line `start()` calling 8 step functions is fine; a 150-line function with inline loops and transformations is not.
