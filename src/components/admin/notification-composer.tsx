"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createNotificationAction } from "@/app/actions/admin-notification-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const categories = [
  { value: "GENERAL", label: "General" },
  { value: "WORKSHOP", label: "Workshop" },
  { value: "HACKATHON", label: "Hackathon" },
  { value: "COHORT", label: "Cohort" },
  { value: "CHALLENGE", label: "Challenge" },
] as const;

const audiences = [
  { value: "ALL", label: "Everyone" },
  { value: "CHALLENGE", label: "60-Day Challenge students" },
  { value: "PROGRAM", label: "AI Cohort members" },
  { value: "HACKATHON", label: "Hackathon participants" },
] as const;

type Category = (typeof categories)[number]["value"];
type Audience = (typeof audiences)[number]["value"];

export function NotificationComposer() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [href, setHref] = useState("");
  const [category, setCategory] = useState<Category>("GENERAL");
  const [audience, setAudience] = useState<Audience>("ALL");
  const [expiresAt, setExpiresAt] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const result = await createNotificationAction({
      title,
      body: body.trim() || undefined,
      href: href.trim() || undefined,
      category,
      audience,
      expiresAt: expiresAt || undefined,
    });
    setPending(false);

    if (result.ok) {
      toast.success("Announcement pushed");
      setTitle("");
      setBody("");
      setHref("");
      setCategory("GENERAL");
      setAudience("ALL");
      setExpiresAt("");
      router.refresh();
      return;
    }
    toast.error(result.message);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border bg-card p-4 md:p-6"
    >
      <div className="space-y-1.5">
        <Label htmlFor="notif-title">Title</Label>
        <Input
          id="notif-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. New workshop announced for Saturday"
          maxLength={120}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notif-body">Body (optional)</Label>
        <Textarea
          id="notif-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="One or two lines of detail."
          maxLength={500}
          rows={3}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="notif-href">Link (optional)</Label>
          <Input
            id="notif-href"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            placeholder="/hackathon or https://…"
            maxLength={300}
          />
          <p className="text-xs text-muted-foreground">
            Must start with / or https://
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notif-expires">Expires (optional)</Label>
          <Input
            id="notif-expires"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            After this it stops showing in the bell.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as Category)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Audience</Label>
          <Select
            value={audience}
            onValueChange={(v) => setAudience(v as Audience)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Audience" />
            </SelectTrigger>
            <SelectContent>
              {audiences.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !title.trim()} className="gap-1.5">
          <Send className="size-4" />
          {pending ? "Pushing…" : "Push announcement"}
        </Button>
      </div>
    </form>
  );
}
