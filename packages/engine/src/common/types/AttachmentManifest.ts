/**
 * The integrity marker both attachment generations commit: the exact file names
 * one publish sent, each with the SHA-256 of the bytes it sent.
 *
 * One shape rather than one per generation — the bytes-and-hashes contract is
 * genuinely one rule, while what each generation must contain is two, and those
 * live with their own publish and restore flows.
 */
export interface AttachmentManifest {
	schemaVersion: 1;
	files: { name: string; sha256: string }[];
}
