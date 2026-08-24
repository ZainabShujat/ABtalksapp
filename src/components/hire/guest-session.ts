import { jobSpecSchema, type JobSpec } from "@/lib/validations/hire";

export const GUEST_SESSION_KEY = "abtalks-hire-guest-session";

export type GuestSessionMessage = {
  role: "user" | "assistant";
  content: string;
  options?: { label: string; value: string }[] | null;
};

export type GuestScoutSession = {
  spec: JobSpec;
  messages: GuestSessionMessage[];
  summary: string;
  readyToSearch: boolean;
  searched: boolean;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function readRaw(): string | null {
  if (!canUseStorage()) return null;
  return (
    window.localStorage.getItem(GUEST_SESSION_KEY) ??
    window.sessionStorage.getItem(GUEST_SESSION_KEY)
  );
}

export function writeGuestSession(session: GuestScoutSession): void {
  if (!canUseStorage()) return;
  const raw = JSON.stringify(session);
  window.localStorage.setItem(GUEST_SESSION_KEY, raw);
  window.sessionStorage.setItem(GUEST_SESSION_KEY, raw);
}

export function clearGuestSession(): void {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(GUEST_SESSION_KEY);
  window.sessionStorage.removeItem(GUEST_SESSION_KEY);
}

export function readGuestSession(): GuestScoutSession | null {
  if (!canUseStorage()) return null;
  try {
    const raw = readRaw();
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const store = parsed as Partial<GuestScoutSession>;
    const spec = jobSpecSchema.safeParse(store.spec);
    if (!spec.success) return null;
    if (!Array.isArray(store.messages)) return null;
    const messages: GuestSessionMessage[] = [];
    for (const row of store.messages) {
      if (!row || typeof row !== "object") continue;
      const m = row as GuestSessionMessage;
      if (m.role !== "user" && m.role !== "assistant") continue;
      if (typeof m.content !== "string") continue;
      messages.push({
        role: m.role,
        content: m.content,
        options: Array.isArray(m.options) ? m.options : null,
      });
    }
    return {
      spec: spec.data,
      messages,
      summary: typeof store.summary === "string" ? store.summary : "Not started",
      readyToSearch: store.readyToSearch === true,
      searched: store.searched === true,
    };
  } catch {
    return null;
  }
}
