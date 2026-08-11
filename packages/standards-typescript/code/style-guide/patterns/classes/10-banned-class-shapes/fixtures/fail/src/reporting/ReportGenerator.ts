interface Row {
	label: string;
	amount: number;
}

// A function with a hat on: one method, nothing held between calls, and every
// caller writing `new ReportGenerator().execute(...)` to reach it.
export class ReportGenerator {
	execute({ rows }: { rows: Row[] }): string {
		return rows.map((row) => `${row.label}: ${row.amount}`).join('\n');
	}
}
