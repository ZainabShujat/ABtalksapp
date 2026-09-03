"use client";

import { createContext, useContext, type ReactNode } from "react";

export const PW_FORM_ID = "pw-section-form";

export type WizardCtx = {
  formId: string;
  onSaved: () => void;
  setDirty: (dirty: boolean) => void;
  saving: boolean;
  setSaving: (saving: boolean) => void;
};

const ProfileWizardContext = createContext<WizardCtx | null>(null);

export function ProfileWizardProvider({
  value,
  children,
}: {
  value: WizardCtx;
  children: ReactNode;
}) {
  return (
    <ProfileWizardContext.Provider value={value}>
      {children}
    </ProfileWizardContext.Provider>
  );
}

export function useProfileWizard(): WizardCtx {
  const ctx = useContext(ProfileWizardContext);
  if (!ctx) {
    throw new Error("useProfileWizard must be used inside ProfileWizardProvider");
  }
  return ctx;
}
