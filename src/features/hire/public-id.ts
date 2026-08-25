/**
 * The label a recruiter sees instead of a candidate's name.
 *
 * Derived from the internal id rather than stored, so there is no migration and
 * no second source of truth that can drift. It is a *label*, never a lookup
 * key: always resolve a candidate through the internal id server-side, and
 * never accept one of these from the client to find a row. Collisions are
 * therefore harmless — two candidates sharing a label is a cosmetic problem,
 * not an access-control one.
 *
 * Deliberately reveals nothing: not the row id, not a sequence (which would
 * leak pool size and join order), not initials.
 *
 * No `import "server-only"` — the client renders this too.
 */
export function candidatePublicId(internalId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < internalId.length; i++) {
    hash ^= internalId.charCodeAt(i);
    // FNV-1a. Math.imul keeps the multiply in 32-bit, which plain * does not.
    hash = Math.imul(hash, 16777619);
  }
  return `AB-${((hash >>> 0) % 9000) + 1000}`;
}
