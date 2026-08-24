"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RecruiterRegisterForm } from "@/components/talent/recruiter-register-form";
import { RecruiterLoginForm } from "@/components/talent/recruiter-login-form";
import type { HireAuthPanel, HireAuthReason } from "@/components/hire/hire-auth-types";

export function RecruiterAuthDialog({
  open,
  reason,
  onOpenChange,
}: {
  open: boolean;
  reason: HireAuthReason;
  onOpenChange: (open: boolean) => void;
}) {
  const stayHere =
    typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : "/hire";

  // Checkout opens register. Nav "Sign in" opens sign-in. Never both forms.
  const [panel, setPanel] = useState<HireAuthPanel>(
    reason === "nav" ? "signin" : "register",
  );

  useEffect(() => {
    if (open) setPanel(reason === "nav" ? "signin" : "register");
  }, [open, reason]);

  const isRegister = panel === "register";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="hire-app hire-auth max-h-[90vh] overflow-y-auto sm:max-w-md"
        showCloseButton
      >
        <DialogHeader>
          <p className="hire-auth__kicker">ABTalks Hire</p>
          <DialogTitle>
            {isRegister ? "Register to send the request" : "Sign in to hire"}
          </DialogTitle>
          <DialogDescription>
            {isRegister
              ? "Your cart stays on this page. Create an account to send it to our team."
              : "We'll email a code to your work address. No password."}
          </DialogDescription>
        </DialogHeader>

        {isRegister ? (
          <>
            <RecruiterRegisterForm />
            <p className="hire-auth__switch">
              Already registered?{" "}
              <button type="button" onClick={() => setPanel("signin")}>
                Sign in
              </button>
            </p>
          </>
        ) : (
          <>
            <RecruiterLoginForm redirectTo={stayHere} />
            <p className="hire-auth__switch">
              New here?{" "}
              <button type="button" onClick={() => setPanel("register")}>
                Register
              </button>
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
