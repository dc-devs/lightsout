// `getShippingProgressPath` stays off this barrel: a caller that can build the
// path can write the file without the recorder's rules.
export type { ShippingProgressReading } from '#src/ship/progress/common/types/ShippingProgressReading.ts';
export { readShippingProgress } from '#src/ship/progress/readShippingProgress.ts';
export { ShippingProgressRecorder } from '#src/ship/progress/ShippingProgressRecorder.ts';
