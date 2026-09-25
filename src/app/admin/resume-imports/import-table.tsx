"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getImportStatusAction,
  queueParseAction,
  registerUploadsAction,
  requestRegistrationAction,
  resolveEmailAction,
  retryFailedAction,
} from "@/app/actions/admin-resume-import-actions";
import type { ImportRowView, ImportStatusView } from "@/features/resume/import/status";

/**
 * Admin résumé import table (plan 154). Client Component.
 *
 * The browser does two things only: upload PDFs straight to private Blob
 * storage (6 at a time, so 1,000+ files never pass through a function body),
 * and send ids to server actions. Parsing and registration run in the
 * server-side worker and keep going if this tab is closed.
 */

type Status = ImportRowView["status"];

const STATUS_LABEL: Record<Status, string> = {
  UPLOADED: "Ready to parse",
  QUEUED: "Queued",
  PROCESSING: "Processing",
  PARSED: "Parsed",
  NEEDS_REVIEW: "Needs review",
  FAILED: "Failed",
  REGISTERED: "Registered",
  CLAIMED: "Claimed",
};

const STATUS_CLASS: Record<Status, string> = {
  UPLOADED: "bg-slate-100 text-slate-700",
  QUEUED: "bg-sky-50 text-sky-700",
  PROCESSING: "bg-sky-100 text-sky-800",
  PARSED: "bg-emerald-50 text-emerald-700",
  NEEDS_REVIEW: "bg-amber-50 text-amber-800",
  FAILED: "bg-red-50 text-red-700",
  REGISTERED: "bg-teal-50 text-teal-800",
  CLAIMED: "bg-teal-100 text-teal-900",
};

const MAX_BYTES = 4 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 6;
const REGISTER_BATCH = 50;
const POLL_MS = 5_000;

type UploadProgress = {
  total: number;
  uploaded: number;
  created: number;
  duplicates: number;
  rejected: { name: string; reason: string }[];
  running: boolean;
};

const EMPTY_PROGRESS: UploadProgress = {
  total: 0,
  uploaded: 0,
  created: 0,
  duplicates: 0,
  rejected: [],
  running: false,
};

function safeStagingName(name: string): string {
  const base = name.replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${(base || "resume").slice(0, 100)}.pdf`;
}

function usd(micro: number): string {
  const dollars = micro / 1_000_000;
  return dollars < 0.01 && dollars > 0 ? "< $0.01" : `$${dollars.toFixed(2)}`;
}

function compact(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
}

export function ImportTable({
  initial,
  attestation,
}: {
  initial: ImportStatusView;
  attestation: string;
}) {
  const [view, setView] = useState<ImportStatusView>(initial);
  const [extraRows, setExtraRows] = useState<ImportRowView[]>([]);
  const [filter, setFilter] = useState<Status | "ALL">("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [autoRegister, setAutoRegister] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress>(EMPTY_PROGRESS);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => [...view.rows, ...extraRows], [view.rows, extraRows]);
  const counts = view.counts;
  const inFlight = counts.QUEUED + counts.PROCESSING;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const active = inFlight > 0 || view.workerRunning || rows.some((r) => r.registerRequested);

  const load = useCallback(async (status: Status | "ALL") => {
    const res = await getImportStatusAction({ status: status === "ALL" ? undefined : status });
    if (res.ok) {
      setView(res.data);
      setExtraRows([]);
    }
  }, []);
  const refresh = useCallback(() => load(filter), [load, filter]);

  // Poll while anything is moving. (A filter change fetches in its handler.)
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [active, refresh]);

  async function loadMore() {
    if (!view.nextCursor) return;
    const res = await getImportStatusAction({
      status: filter === "ALL" ? undefined : filter,
      cursor: view.nextCursor,
    });
    if (res.ok) {
      setExtraRows((prev) => [...prev, ...res.data.rows]);
      setView((v) => ({ ...v, nextCursor: res.data.nextCursor }));
    }
  }

  /* ─── Upload ─── */

  async function uploadFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const all = Array.from(list);
    const pdfs = all.filter((f) => f.name.toLowerCase().endsWith(".pdf") && f.size > 0 && f.size <= MAX_BYTES);
    const skipped = all
      .filter((f) => !pdfs.includes(f))
      .map((f) => ({
        name: f.name,
        reason: f.size > MAX_BYTES ? "Larger than 4 MB." : "Not a PDF.",
      }));
    setProgress({ ...EMPTY_PROGRESS, total: pdfs.length, rejected: skipped, running: true });

    const staged: { pathname: string; name: string }[] = [];
    let cursor = 0;

    async function flush(force: boolean) {
      while (staged.length >= REGISTER_BATCH || (force && staged.length > 0)) {
        const batch = staged.splice(0, REGISTER_BATCH);
        const res = await registerUploadsAction({ files: batch });
        if (res.ok) {
          setProgress((p) => ({
            ...p,
            created: p.created + res.data.created,
            duplicates: p.duplicates + res.data.duplicates,
            rejected: [...p.rejected, ...res.data.rejected],
          }));
        } else {
          setProgress((p) => ({
            ...p,
            rejected: [...p.rejected, ...batch.map((b) => ({ name: b.name, reason: res.message }))],
          }));
        }
      }
    }

    async function worker() {
      while (cursor < pdfs.length) {
        const file = pdfs[cursor++]!;
        try {
          const blob = await upload(`resume-imports/staging/${safeStagingName(file.name)}`, file, {
            access: "private",
            handleUploadUrl: "/api/admin/resume-imports/upload",
            contentType: "application/pdf",
          });
          staged.push({ pathname: blob.pathname, name: file.name });
          setProgress((p) => ({ ...p, uploaded: p.uploaded + 1 }));
          if (staged.length >= REGISTER_BATCH) await flush(false);
        } catch {
          setProgress((p) => ({
            ...p,
            rejected: [...p.rejected, { name: file.name, reason: "Upload failed — try again." }],
          }));
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pdfs.length) }, worker));
    await flush(true);
    setProgress((p) => ({ ...p, running: false }));
    if (fileInput.current) fileInput.current.value = "";
    if (folderInput.current) folderInput.current.value = "";
    await refresh();
  }

  /* ─── Actions ─── */

  async function run<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; message: string }>, done: (d: T) => string) {
    setBusy(true);
    try {
      const res = await fn();
      if (res.ok) toast.success(done(res.data));
      else toast.error(res.message);
      setSelected(new Set());
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const selectedIds = [...selected];
  const needsConsent = autoRegister && !consent;

  function parse(which: "selected" | "all") {
    if (needsConsent) {
      toast.error("Confirm the students' consent to register them after parsing.");
      return;
    }
    void run(
      () =>
        queueParseAction({
          selection: which === "all" ? { all: true } : { ids: selectedIds },
          autoRegister,
          consentAttested: consent,
        }),
      (d) => `${d.queued} résumé(s) queued for parsing.`,
    );
  }

  function register(which: "selected" | "all") {
    if (!consent) {
      toast.error("Confirm the students' consent before registering them.");
      return;
    }
    void run(
      () =>
        requestRegistrationAction({
          selection: which === "all" ? { all: true } : { ids: selectedIds },
          consentAttested: true,
        }),
      (d) => `${d.requested} student(s) will be registered.`,
    );
  }

  function retry(which: "selected" | "all") {
    void run(
      () => retryFailedAction(which === "all" ? { all: true } : { ids: selectedIds }),
      (d) => `${d.queued} failed résumé(s) queued again.`,
    );
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const etaMin =
    view.usage.parsedLastHour > 0 && inFlight > 0
      ? Math.ceil(inFlight / (view.usage.parsedLastHour / 60))
      : null;
  const parsedDocs = counts.PARSED + counts.NEEDS_REVIEW + counts.REGISTERED + counts.CLAIMED;

  return (
    <div className="space-y-6">
      {/* Upload */}
      <section className="rounded-xl border border-[#E9E9E9] bg-white p-5">
        <h2 className="font-display text-lg font-semibold text-[#353535]">Upload résumés</h2>
        <p className="mt-1 text-sm text-[#787878]">
          PDFs up to 4 MB. Choose files or a whole folder. Keep this tab open until the upload
          finishes — parsing continues on the server even after you close it. The same PDF uploaded
          twice is stored once.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => void uploadFiles(e.target.files)}
          />
          <input
            ref={folderInput}
            type="file"
            multiple
            className="hidden"
            // Folder picking is non-standard; set via attribute so React passes it through.
            {...({ webkitdirectory: "" } as Record<string, string>)}
            onChange={(e) => void uploadFiles(e.target.files)}
          />
          <Button disabled={progress.running} onClick={() => fileInput.current?.click()}>
            Choose PDFs
          </Button>
          <Button variant="outline" disabled={progress.running} onClick={() => folderInput.current?.click()}>
            Choose folder
          </Button>
        </div>
        {progress.total + progress.rejected.length > 0 && (
          <div className="mt-4 text-sm text-[#353535]">
            <p>
              {progress.running ? "Uploading… " : "Upload finished. "}
              {progress.uploaded}/{progress.total} uploaded · {progress.created} new ·{" "}
              {progress.duplicates} duplicate(s) · {progress.rejected.length} rejected
            </p>
            {progress.rejected.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[#787878]">Show rejected files</summary>
                <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-[#787878]">
                  {progress.rejected.map((r, i) => (
                    <li key={`${r.name}-${i}`}>
                      {r.name} — {r.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      {/* Progress */}
      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Total", total],
          ["Ready to parse", counts.UPLOADED],
          ["Queued / processing", inFlight],
          ["Parsed", counts.PARSED],
          ["Needs review", counts.NEEDS_REVIEW],
          ["Failed", counts.FAILED],
          ["Registered", counts.REGISTERED],
          ["Claimed by student", counts.CLAIMED],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[#E9E9E9] bg-white px-4 py-3">
            <p className="text-xs text-[#8F8F8F]">{label}</p>
            <p className="font-display text-2xl font-semibold text-[#353535]">{value}</p>
          </div>
        ))}
        <div className="rounded-xl border border-[#E9E9E9] bg-white px-4 py-3 sm:col-span-3 lg:col-span-4">
          <p className="text-xs text-[#8F8F8F]">OpenAI usage (imports, actual)</p>
          <p className="text-sm text-[#353535]">
            {compact(view.usage.promptTokens)} in · {compact(view.usage.completionTokens)} out ·{" "}
            {usd(view.usage.costMicroUsd)} total
            {parsedDocs > 0 ? ` · ${usd(Math.round(view.usage.costMicroUsd / parsedDocs))} per résumé` : ""} ·{" "}
            {view.usage.rateLimitedLastHour} rate-limited in the last hour
          </p>
          <p className="mt-1 text-xs text-[#8F8F8F]">
            {view.workerRunning ? "Worker running" : inFlight > 0 ? "Worker starting…" : "Idle"}
            {etaMin !== null ? ` · about ${etaMin} min left at the current rate` : ""}
          </p>
        </div>
      </section>

      {/* Actions */}
      <section className="space-y-3 rounded-xl border border-[#E9E9E9] bg-white p-5">
        <label className="flex items-start gap-2 text-sm text-[#353535]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            <strong>Consent.</strong> {attestation} Required to register students — registered students
            are visible to recruiters before they sign in. Contact details stay locked until they do.
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-[#353535]">
          <input type="checkbox" checked={autoRegister} onChange={(e) => setAutoRegister(e.target.checked)} />
          Register students automatically once their résumé is parsed
        </label>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || selectedIds.length === 0} onClick={() => parse("selected")}>
            Parse selected ({selectedIds.length})
          </Button>
          <Button variant="outline" disabled={busy || counts.UPLOADED === 0} onClick={() => parse("all")}>
            Parse all ready ({counts.UPLOADED})
          </Button>
          <Button variant="outline" disabled={busy || counts.FAILED === 0} onClick={() => retry("all")}>
            Retry all failed ({counts.FAILED})
          </Button>
          <Button
            variant="secondary"
            disabled={busy || selectedIds.length === 0 || !consent}
            onClick={() => register("selected")}
          >
            Register selected
          </Button>
          <Button
            variant="secondary"
            disabled={busy || counts.PARSED === 0 || !consent}
            onClick={() => register("all")}
          >
            Register all parsed ({counts.PARSED})
          </Button>
        </div>
      </section>

      {/* Table */}
      <section className="overflow-hidden rounded-xl border border-[#E9E9E9] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E9E9] px-5 py-3">
          <h2 className="font-display text-lg font-semibold text-[#353535]">Imports</h2>
          <select
            className="rounded-md border border-[#E9E9E9] bg-white px-2 py-1 text-sm"
            value={filter}
            onChange={(e) => {
              const next = e.target.value as Status | "ALL";
              setSelected(new Set());
              setFilter(next);
              void load(next);
            }}
          >
            <option value="ALL">All statuses</option>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]} ({counts[s]})
              </option>
            ))}
          </select>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-[#787878]">No résumés here yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F7FBFB] text-left text-xs text-[#8F8F8F]">
                <tr>
                  <th className="w-10 px-4 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={allOnPageSelected}
                      onChange={() =>
                        setSelected(allOnPageSelected ? new Set() : new Set(rows.map((r) => r.id)))
                      }
                    />
                  </th>
                  <th className="px-2 py-2">File</th>
                  <th className="px-2 py-2">Email</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Score</th>
                  <th className="px-2 py-2">Details</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E9E9E9]">
                {rows.map((row) => (
                  <ImportRow
                    key={row.id}
                    row={row}
                    selected={selected.has(row.id)}
                    busy={busy}
                    onToggle={() => toggle(row.id)}
                    onParse={() =>
                      void run(
                        () =>
                          queueParseAction({
                            selection: { ids: [row.id] },
                            autoRegister: autoRegister && consent,
                            consentAttested: consent,
                          }),
                        () => "Queued for parsing.",
                      )
                    }
                    onRetry={() => void run(() => retryFailedAction({ ids: [row.id] }), () => "Queued again.")}
                    onResolve={(email) =>
                      void run(() => resolveEmailAction({ id: row.id, email }), (d) => `Email set to ${d.email}.`)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view.nextCursor && (
          <div className="border-t border-[#E9E9E9] px-5 py-3">
            <Button variant="outline" size="sm" onClick={() => void loadMore()}>
              Load more
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function ImportRow({
  row,
  selected,
  busy,
  onToggle,
  onParse,
  onRetry,
  onResolve,
}: {
  row: ImportRowView;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  onParse: () => void;
  onRetry: () => void;
  onResolve: (email: string) => void;
}) {
  const [email, setEmail] = useState(row.emailCandidates[0] ?? row.email ?? "");

  return (
    <tr className={selected ? "bg-[#F7FBFB]" : undefined}>
      <td className="px-4 py-2 align-top">
        <input type="checkbox" aria-label={`Select ${row.originalFilename}`} checked={selected} onChange={onToggle} />
      </td>
      <td className="max-w-[220px] truncate px-2 py-2 align-top font-medium text-[#353535]" title={row.originalFilename}>
        {row.originalFilename}
      </td>
      <td className="px-2 py-2 align-top text-[#353535]">
        {row.status === "NEEDS_REVIEW" ? (
          <div className="flex flex-wrap items-center gap-1">
            {row.emailCandidates.length > 1 ? (
              <select
                className="rounded-md border border-[#E9E9E9] px-1 py-0.5"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              >
                {row.emailCandidates.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="w-48 rounded-md border border-[#E9E9E9] px-1 py-0.5"
                placeholder="student@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
            <Button size="sm" variant="outline" disabled={busy || !email} onClick={() => onResolve(email)}>
              Save
            </Button>
          </div>
        ) : (
          (row.email ?? <span className="text-[#8F8F8F]">—</span>)
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </span>
        {row.registerRequested && row.status === "PARSED" && (
          <span className="ml-1 text-xs text-[#8F8F8F]">registering…</span>
        )}
      </td>
      <td className="px-2 py-2 align-top text-[#353535]">{row.overallScore ?? "—"}</td>
      <td className="max-w-[280px] px-2 py-2 align-top text-xs text-[#787878]">
        {row.lastError ?? (row.linkedExisting ? "Added to an existing account." : "")}
        {row.attempts > 1 ? ` (attempt ${row.attempts})` : ""}
      </td>
      <td className="px-2 py-2 text-right align-top">
        {row.status === "UPLOADED" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onParse}>
            Parse
          </Button>
        )}
        {row.status === "FAILED" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
            Retry
          </Button>
        )}
      </td>
    </tr>
  );
}
