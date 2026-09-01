"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/app/actions/candidate-profile-actions";

/**
 * Saves one section and refreshes the server tree so profile strength and every
 * other section's derived state recompute from the database rather than from an
 * optimistic guess made here.
 */
export function useSectionSave(
  action: (payload: unknown) => Promise<ActionResult>,
  label: string,
) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (payload: unknown): Promise<boolean> => {
      setSaving(true);
      try {
        const result = await action(payload);
        if (!result.ok) {
          toast.error(result.message);
          return false;
        }
        toast.success(`${label} saved`);
        router.refresh();
        return true;
      } catch {
        toast.error("Could not save. Please try again.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [action, label, router],
  );

  return { saving, save };
}
