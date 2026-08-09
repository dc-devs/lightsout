/**
 * Maps raw rows onto the shape the report expects.
 *
 * @typeParam Row - the row shape the caller reads back
 * @param rows - the raw rows, in source order
 */
export const mapRecords = <Row>({ rows }: { rows: Row[] }): Row[] => [...rows];
