/**
 * The looks a tab strip can wear: a rule under the labels for tabs inside a
 * page, and a column of cards beside the panel for a showcase whose tabs carry
 * a sentence each.
 */
export const TabsVariant = { Underline: 'underline', Side: 'side' } as const;

export type TabsVariant = (typeof TabsVariant)[keyof typeof TabsVariant];
