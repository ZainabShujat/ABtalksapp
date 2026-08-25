"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { addEngagementCommentAction } from "@/app/actions/hire-request-actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ThreadMessage = {
  id: string;
  authorRole: string;
  body: string;
  /** ISO string — dates never cross the Server→Client boundary as objects. */
  createdAt: string;
};

export function EngagementThread({
  engagementId,
  messages,
  canPost,
}: {
  engagementId: string;
  messages: ThreadMessage[];
  canPost: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  function post() {
    if (!body.trim()) return;
    startTransition(async () => {
      const res = await addEngagementCommentAction({ engagementId, body });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setBody("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {messages.length > 0 && (
        <ul className="space-y-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className={cn(
                "rounded-lg px-3 py-2 text-sm",
                m.authorRole === "admin"
                  ? "bg-primary/5 text-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              <p className="mb-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {m.authorRole === "admin" ? "ABTalks team" : "You"} ·{" "}
                {m.createdAt.slice(0, 10)}
              </p>
              <p className="leading-relaxed whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ul>
      )}

      {canPost && (
        <div className="flex gap-2">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                post();
              }
            }}
            maxLength={2000}
            placeholder="Add a comment for our team…"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
          />
          <button
            type="button"
            disabled={pending || !body.trim()}
            onClick={post}
            className={cn(
              buttonVariants({ size: "sm" }),
              "shrink-0 gap-1.5 disabled:opacity-50",
            )}
          >
            {pending && (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            )}
            Post
          </button>
        </div>
      )}
    </div>
  );
}
