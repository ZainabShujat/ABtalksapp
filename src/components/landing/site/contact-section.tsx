"use client";

import { useState, useTransition } from "react";
import { submitContactMessage } from "@/app/actions/contact-actions";
import { Reveal } from "./motion/reveal";

const RULES: Record<string, (v: string) => true | string> = {
  name: (v) => v.trim().length >= 2 || "Please enter your full name.",
  phone: (v) =>
    /^[+]?[\d\s()-]{7,18}$/.test(v.trim()) ||
    "Please enter a valid phone number.",
  email: (v) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ||
    "Please enter a valid email address.",
  message: (v) =>
    v.trim().length >= 10 ||
    "Please tell us a little more (10 characters minimum).",
};

type FieldName = "name" | "phone" | "email" | "message";

export function ContactSection() {
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>(
    {},
  );
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function validateField(input: HTMLInputElement | HTMLTextAreaElement) {
    const rule = RULES[input.name];
    if (!rule) return true;
    const result = rule(input.value);
    const ok = result === true;
    input.classList.toggle("is-error", !ok);
    input.setAttribute("aria-invalid", String(!ok));
    setErrors((prev) => ({
      ...prev,
      [input.name]: ok ? undefined : result,
    }));
    return ok;
  }

  function onBlur(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
    validateField(e.currentTarget);
  }

  function onInput(e: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const input = e.currentTarget;
    if (input.classList.contains("is-error")) validateField(input);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSuccess(false);
    setFormError("");
    const form = e.currentTarget;
    const inputs = Array.from(
      form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".input"),
    );
    let firstInvalid: HTMLInputElement | HTMLTextAreaElement | null = null;
    for (const input of inputs) {
      if (!validateField(input) && !firstInvalid) firstInvalid = input;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    const data = {
      name: (form.elements.namedItem("name") as HTMLInputElement).value.trim(),
      phone: (form.elements.namedItem("phone") as HTMLInputElement).value.trim(),
      email: (form.elements.namedItem("email") as HTMLInputElement).value.trim(),
      message: (form.elements.namedItem("message") as HTMLTextAreaElement)
        .value.trim(),
    };

    startTransition(async () => {
      const result = await submitContactMessage(data);
      if (result.ok) {
        form.reset();
        setErrors({});
        setSuccess(true);
        return;
      }
      setFormError(result.message);
    });
  }

  return (
    <section className="section contact" id="contact">
      <div className="container contact__grid">
        <Reveal className="contact__text">
          <p className="section-label">Contact us</p>
          <h2 className="h2">
            Have any questions or stuck somewhere? We are here to help.
          </h2>
          <p className="p">We reply within one working day.</p>
        </Reveal>

        <Reveal
          as="form"
          className="form"
          id="contactForm"
          noValidate
          onSubmit={onSubmit}
        >
          <div className="field">
            <label className="label" htmlFor="name">
              Full Name
            </label>
            <input
              className="input"
              id="name"
              name="name"
              type="text"
              placeholder="Your Name"
              required
              onBlur={onBlur}
              onInput={onInput}
            />
            <p className="error" data-error-for="name">
              {errors.name ?? ""}
            </p>
          </div>

          <div className="field">
            <label className="label" htmlFor="phone">
              Phone Number
            </label>
            <input
              className="input"
              id="phone"
              name="phone"
              type="tel"
              placeholder="Your Phone Number"
              required
              onBlur={onBlur}
              onInput={onInput}
            />
            <p className="error" data-error-for="phone">
              {errors.phone ?? ""}
            </p>
          </div>

          <div className="field">
            <label className="label" htmlFor="email">
              Email Address
            </label>
            <input
              className="input"
              id="email"
              name="email"
              type="email"
              placeholder="Your Email"
              required
              onBlur={onBlur}
              onInput={onInput}
            />
            <p className="error" data-error-for="email">
              {errors.email ?? ""}
            </p>
          </div>

          <div className="field">
            <label className="label" htmlFor="message">
              Message
            </label>
            <textarea
              className="input textarea"
              id="message"
              name="message"
              placeholder="Type something here...."
              required
              onBlur={onBlur}
              onInput={onInput}
            />
            <p className="error" data-error-for="message">
              {errors.message ?? ""}
            </p>
          </div>

          <button
            className="btn btn--primary btn--lg btn--block"
            type="submit"
            disabled={pending}
          >
            Send Message
          </button>
          {formError ? (
            <p className="error" data-error-for="form">
              {formError}
            </p>
          ) : null}
          <p
            className="form__success"
            id="formSuccess"
            role="status"
            hidden={!success}
          >
            Thanks — your message is on its way. We&apos;ll be in touch shortly.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
