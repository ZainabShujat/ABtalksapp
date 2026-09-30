"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateWorkshopConfigAction } from "@/app/actions/admin-config-actions";

export type WorkshopConfigValues = {
  mode: string;
  calendarVisible: boolean;
  whatsappLink: string;
  zoomLink: string;
  comingSoonMessage: string;
};

/**
 * Workshop surface controls on /admin/settings. Plan 163 phase 3b.
 *
 * Three independent switches, and the copy says so — this feature's recurring
 * bug has been controls quietly affecting each other:
 *
 *  - **Mode** hides the workshop hero. It can only force Coming Soon ON; with
 *    no eligible published workshop the page shows Coming Soon regardless.
 *  - **Calendar** shows or hides the calendar, in both states.
 *  - **Links** are content, and touch neither.
 *
 * There is no countdown control, deliberately: the timer is the event's own
 * date and time.
 */
export function WorkshopConfigPanel({
  values,
}: {
  values: WorkshopConfigValues;
}) {
  const router = useRouter();
  const [v, setV] = useState(values);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await updateWorkshopConfigAction({ ...v, reason: reason.trim() });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Workshop settings saved");
      setReason("");
      router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded-xl border p-5">
      <div>
        <h2 className="font-semibold">Workshop page &amp; links</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Controls the public /workshop experience, including the Zoom and
          WhatsApp links used by the registration flow. The countdown is not
          here — it comes from the workshop&apos;s own date and time.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Page mode</Label>
        <select
          className="h-9 w-full max-w-sm rounded-md border bg-background px-3 text-sm"
          value={v.mode}
          onChange={(e) => setV({ ...v, mode: e.target.value })}
          disabled={pending}
        >
          <option value="LIVE">LIVE — show the published workshop</option>
          <option value="COMING_SOON">COMING_SOON — hide it</option>
        </select>
        <p className="text-xs text-muted-foreground">
          With no eligible published workshop the page shows Coming Soon whatever
          this says. LIVE cannot make it invent one.
        </p>
      </div>

      <label className="flex max-w-sm items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={v.calendarVisible}
          onChange={(e) => setV({ ...v, calendarVisible: e.target.checked })}
          disabled={pending}
        />
        <span>
          <span className="font-medium">Show the events calendar</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Independent of the mode. Shows in the Coming Soon state too, with
            its TBA Saturday tiles.
          </span>
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="wk-whatsapp">WhatsApp community link</Label>
          <p className="text-xs text-muted-foreground">
            Shown after registering, and in the confirmation email.
            <span className="font-mono"> workshop.whatsapp_link</span>
          </p>
          <Input
            id="wk-whatsapp"
            value={v.whatsappLink}
            onChange={(e) => setV({ ...v, whatsappLink: e.target.value })}
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wk-zoom">Zoom / joining link</Label>
          <p className="text-xs text-muted-foreground">
            The join button in the confirmation email. Empty hides that button.
            <span className="font-mono"> workshop.zoom_link</span>
          </p>
          <Input
            id="wk-zoom"
            value={v.zoomLink}
            onChange={(e) => setV({ ...v, zoomLink: e.target.value })}
            disabled={pending}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="wk-soon">Coming Soon message</Label>
        <Textarea
          id="wk-soon"
          value={v.comingSoonMessage}
          onChange={(e) => setV({ ...v, comingSoonMessage: e.target.value })}
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">
          Leave empty to use the built-in copy.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="wk-reason">Reason</Label>
        <Textarea
          id="wk-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={8}
        />
      </div>

      <Button
        type="button"
        onClick={save}
        disabled={pending || reason.trim().length < 8}
      >
        {pending ? "Saving..." : "Save workshop settings"}
      </Button>
    </section>
  );
}
