---
summary: "a helper a second file needs while it still sits unexported in the first"
checked: false
severity: advisory
---

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
