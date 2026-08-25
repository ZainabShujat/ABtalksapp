"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { RecruiterAuthDialog } from "@/components/hire/recruiter-auth-dialog";
import type { HireAuthReason } from "@/components/hire/hire-auth-types";

export type { HireAuthReason };

type HireAuthContextValue = {
  approved: boolean;
  signedIn: boolean;
  pending: boolean;
  authEnabled: boolean;
  openAuth: (reason: HireAuthReason) => void;
};

const HireAuthContext = createContext<HireAuthContextValue | null>(null);

export function useHireAuth(): HireAuthContextValue {
  const ctx = useContext(HireAuthContext);
  if (!ctx) {
    return {
      approved: false,
      signedIn: false,
      pending: false,
      authEnabled: false,
      openAuth: () => {
        window.location.href = "/hire";
      },
    };
  }
  return ctx;
}

export function HireAuthProvider({
  approved,
  signedIn,
  pending,
  authEnabled,
  children,
}: {
  approved: boolean;
  signedIn: boolean;
  pending: boolean;
  authEnabled: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<HireAuthReason>("nav");

  const openAuth = useCallback((next: HireAuthReason) => {
    setReason(next);
    setOpen(true);
  }, []);

  const value = useMemo(
    () => ({ approved, signedIn, pending, authEnabled, openAuth }),
    [approved, signedIn, pending, authEnabled, openAuth],
  );

  return (
    <HireAuthContext.Provider value={value}>
      {children}
      <RecruiterAuthDialog
        open={open}
        reason={reason}
        authEnabled={authEnabled}
        onOpenChange={setOpen}
      />
    </HireAuthContext.Provider>
  );
}
