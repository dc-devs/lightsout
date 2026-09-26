import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';

interface Params {
	record: WorkOrderState;
}

/**
 * The one byte form of a work order state: keys sorted at every depth, arrays in
 * their own order, tab indented with a trailing newline, UTF-8.
 *
 * Every writer and every hasher goes through here, so two machines that build
 * the same record with their object literals written in different orders
 * produce identical bytes — which is what lets a published copy be compared to
 * a local one by hash at all. The re-parse is how `canonicalJson`'s sorted
 * order reaches `JSON.stringify`'s indenting: object key order survives a JSON
 * round trip, so the pretty form carries the canonical order.
 */
export const serializeWorkOrderState = ({ record }: Params): Buffer => {
	const sorted: unknown = JSON.parse(canonicalJson({ value: record }));

	return Buffer.from(`${JSON.stringify(sorted, undefined, '\t')}\n`, 'utf8');
};
