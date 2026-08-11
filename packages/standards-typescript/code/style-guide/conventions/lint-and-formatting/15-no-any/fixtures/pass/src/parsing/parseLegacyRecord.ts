// The rare, justified bypass the rule allows, with the reason written down.
// biome-ignore lint/suspicious/noExplicitAny: the vendor callback is untyped and its shape is not published
export const parseLegacyRecord = ({ raw }: { raw: any }): string => String(raw);
