import "server-only";
import { randomBytes } from "node:crypto";

/**
 * The password an admin issues when creating a recruiter (plan 159).
 *
 * The admin reads this off a screen and pastes it into a chat or reads it
 * aloud, so the alphabet drops every glyph pair that is ambiguous in a sans
 * font: 0/O, 1/l/I. What is left is 55 characters.
 *
 * **Rejection sampling, not modulo.** 55 does not divide 256, so `byte % 55`
 * would make the first 36 characters ~1.4x more likely than the rest — a
 * measurable bias in a credential. Bytes landing in the short tail are
 * discarded instead. (`generateProgramJoinCode` in lib/program-auth.ts uses
 * plain modulo and is correct there: its alphabet is exactly 32 characters, so
 * 256 divides evenly. Do not copy that shape here.)
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** ~117 bits over this alphabet. Long enough that nothing else has to be. */
export const GENERATED_PASSWORD_LENGTH = 20;

/** Bytes at or above this would wrap and over-represent the low characters. */
const CEILING = 256 - (256 % ALPHABET.length);

export function generateRecruiterPassword(
  length: number = GENERATED_PASSWORD_LENGTH,
): string {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error("Password length must be a positive integer.");
  }

  let out = "";
  // Drawn in blocks so a discarded byte costs an array index, not a syscall.
  // Over-sized on purpose: at 55/64 acceptance a block of 2n covers n almost
  // always, and the loop simply draws again when it does not.
  while (out.length < length) {
    const block = randomBytes(Math.max(32, (length - out.length) * 2));
    for (const byte of block) {
      if (byte >= CEILING) continue;
      out += ALPHABET[byte % ALPHABET.length]!;
      if (out.length === length) break;
    }
  }
  return out;
}
