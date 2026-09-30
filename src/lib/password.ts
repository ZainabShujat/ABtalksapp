import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/*
 * Password hashing (plan 154).
 *
 * scrypt from node:crypto — no native module and no new dependency, so it runs
 * the same on Vercel, in `next dev` and in the seed script. Parameters are
 * OWASP's scrypt option N=2^15, r=8, p=3: 32 MiB per hash, which a serverless
 * function can afford on every sign-in, where N=2^17 would cost 128 MiB.
 *
 * The parameters are stored inside every hash, so they can be raised later
 * without invalidating anyone: old hashes keep verifying with their own.
 *
 * Deliberately no `import "server-only"`: `prisma/seed.ts` runs under plain
 * tsx and hashes the test users' passwords with this file. Nothing here is a
 * secret; the hashes are.
 */

const PREFIX = "scrypt";
const LOG2_N = 15;
const BLOCK_SIZE = 8;
const PARALLELISM = 3;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/** Upper bounds on parameters read back from a stored hash. */
const MAX_LOG2_N = 20;
const MAX_BLOCK_SIZE = 16;
const MAX_PARALLELISM = 16;

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function optionsFor(log2N: number, r: number, p: number): ScryptOptions {
  const N = 2 ** log2N;
  // Node refuses when 128·N·r reaches maxmem; leave headroom above it.
  return { N, r, p, maxmem: 256 * N * r };
}

/**
 * NFKC so the same password typed on a phone keyboard and a laptop hashes the
 * same (composed vs decomposed accents, full-width digits).
 */
function normalise(password: string): string {
  return password.normalize("NFKC");
}

type ParsedHash = {
  log2N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
};

function parse(stored: string | null | undefined): ParsedHash | null {
  if (!stored) return null;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;
  const log2N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (
    !Number.isInteger(log2N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    log2N < 10 ||
    log2N > MAX_LOG2_N ||
    r < 1 ||
    r > MAX_BLOCK_SIZE ||
    p < 1 ||
    p > MAX_PARALLELISM
  ) {
    return null;
  }
  const salt = Buffer.from(parts[4], "base64url");
  const hash = Buffer.from(parts[5], "base64url");
  if (salt.length < SALT_BYTES || hash.length !== KEY_LENGTH) return null;
  return { log2N, r, p, salt, hash };
}

/**
 * Whether a stored `User.password` is a hash this file can verify. Anything
 * else — null, or a plain-text value left by an old dev seed — means the
 * account has no usable password, and it is never compared as text.
 */
export function isUsablePasswordHash(stored: string | null | undefined): boolean {
  return parse(stored) !== null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scrypt(
    normalise(password),
    salt,
    KEY_LENGTH,
    optionsFor(LOG2_N, BLOCK_SIZE, PARALLELISM),
  );
  return [
    PREFIX,
    LOG2_N,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) {
    await burnPasswordCheck(password);
    return false;
  }
  const candidate = await scrypt(
    normalise(password),
    parsed.salt,
    KEY_LENGTH,
    optionsFor(parsed.log2N, parsed.r, parsed.p),
  );
  return timingSafeEqual(candidate, parsed.hash);
}

const BURN_SALT = Buffer.alloc(SALT_BYTES, 7);

/**
 * Spend the same time a real check would. Called when there is no account or
 * no password, so "no such user" and "wrong password" take equally long and
 * the response time does not say which emails have accounts.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  await scrypt(
    normalise(password),
    BURN_SALT,
    KEY_LENGTH,
    optionsFor(LOG2_N, BLOCK_SIZE, PARALLELISM),
  );
}
