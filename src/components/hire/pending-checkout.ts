export const PENDING_CHECKOUT_KEY = "abtalks-hire-pending-checkout";
export const CHECKOUT_FLASH_KEY = "abtalks-hire-checkout-flash";

/**
 * A request the recruiter pressed before they had an account.
 *
 * Holds candidate *refs*, not program member ids: the intent that survives a
 * sign-in has to be able to name a challenge candidate too, and the two pools
 * are only interchangeable through the one handle.
 */
export type PendingCheckout = {
  candidateRefs: string[];
  note?: string;
};

export type CheckoutFlash = {
  placed: number;
  skipped: number;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

export function savePendingCheckout(intent: PendingCheckout): void {
  if (!canUseStorage()) return;
  const ids = [...new Set(intent.candidateRefs.filter(Boolean))].slice(0, 25);
  if (ids.length === 0) return;
  window.sessionStorage.setItem(
    PENDING_CHECKOUT_KEY,
    JSON.stringify({
      candidateRefs: ids,
      note: intent.note?.trim() || undefined,
    }),
  );
}

export function readPendingCheckout(): PendingCheckout | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_CHECKOUT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const ids = (parsed as PendingCheckout).candidateRefs;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      return null;
    }
    const note = (parsed as PendingCheckout).note;
    return {
      candidateRefs: ids.slice(0, 25),
      note: typeof note === "string" && note.trim() ? note.trim() : undefined,
    };
  } catch {
    return null;
  }
}

export function clearPendingCheckout(): void {
  if (!canUseStorage()) return;
  window.sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
}

export function saveCheckoutFlash(flash: CheckoutFlash): void {
  if (!canUseStorage()) return;
  window.sessionStorage.setItem(CHECKOUT_FLASH_KEY, JSON.stringify(flash));
}

export function takeCheckoutFlash(): CheckoutFlash | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_FLASH_KEY);
    window.sessionStorage.removeItem(CHECKOUT_FLASH_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const placed = (parsed as CheckoutFlash).placed;
    const skipped = (parsed as CheckoutFlash).skipped;
    if (typeof placed !== "number" || typeof skipped !== "number") return null;
    return { placed, skipped };
  } catch {
    return null;
  }
}
