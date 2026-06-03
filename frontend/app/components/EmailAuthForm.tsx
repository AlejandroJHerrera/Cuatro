"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { copy } from "@/lib/copy";
import { BACKEND_URL } from "@/lib/api";

type Mode = "signin" | "signup";

type Props = {
  /** Where to send the user after a successful auth. Already sanitized server-side. */
  next: string;
};

/**
 * Email + password form with a sign-in / sign-up toggle.
 *
 * POSTs to the backend with credentials so the session cookie is set on the
 * browser; on success, soft-navigates to `next`. Errors come straight from the
 * backend's `{ error }` payload.
 */
export function EmailAuthForm({ next }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signup");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const emailId = useId();
  const pwId = useId();
  const errorId = useId();

  const isSignup = mode === "signup";

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const body: Record<string, string> = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    };
    if (isSignup) body.name = String(form.get("name") ?? "");

    try {
      const path = isSignup ? "/api/auth/signup" : "/api/auth/signin";
      const res = await fetch(`${BACKEND_URL}${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? copy.signin.genericError);
        setSubmitting(false);
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError(copy.signin.networkError);
      setSubmitting(false);
    }
  };

  const ctaLabel = submitting
    ? copy.signin.submittingLabel
    : isSignup
    ? copy.signin.signupCta
    : copy.signin.signinCta;

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-6"
      noValidate={false}
      aria-describedby={error ? errorId : undefined}
    >
      {/* Name field — slides in on sign-up. */}
      {isSignup && (
        <Field
          id={nameId}
          label={copy.signin.nameLabel}
          name="name"
          type="text"
          autoComplete="name"
          placeholder={copy.signin.namePlaceholder}
          required
        />
      )}

      <Field
        id={emailId}
        label={copy.signin.emailLabel}
        name="email"
        type="email"
        autoComplete="email"
        placeholder={copy.signin.emailPlaceholder}
        required
      />

      <Field
        id={pwId}
        label={copy.signin.passwordLabel}
        name="password"
        type="password"
        autoComplete={isSignup ? "new-password" : "current-password"}
        required
        minLength={8}
        hint={isSignup ? copy.signin.passwordHint : undefined}
      />

      {error && (
        <p
          id={errorId}
          role="alert"
          className="m-0 font-mono text-[0.6875rem] uppercase text-gold"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting || undefined}
        className="
          group relative inline-flex items-center justify-center
          min-h-14 w-full
          px-6 py-3
          font-body font-medium text-base uppercase
          bg-gold text-hall border border-gold
          transition-[background,box-shadow,opacity] duration-200 ease-out-quart
          hover:bg-gold-deep
          hover:shadow-[0_0_0_5px_var(--color-gold-glow)]
          focus-visible:outline-none
          focus-visible:shadow-[0_0_0_3px_var(--color-hall),0_0_0_5px_var(--color-gold)]
          disabled:opacity-60 disabled:cursor-not-allowed
          disabled:hover:bg-gold disabled:hover:shadow-none
        "
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {submitting && (
          <span
            aria-hidden="true"
            className="
              mr-2 inline-block h-3 w-3 rounded-full border-2
              border-hall/30 border-t-hall animate-spin
            "
          />
        )}
        {ctaLabel}
      </button>

      <button
        type="button"
        onClick={() => setMode(isSignup ? "signin" : "signup")}
        className="
          self-center font-mono text-[0.6875rem] uppercase text-bulb/65
          border-b border-ash/35 pb-px
          transition-colors duration-200 ease-out-quart
          hover:text-gold hover:border-gold
          focus-visible:outline-none focus-visible:text-gold focus-visible:border-gold
        "
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {isSignup ? copy.signin.toggleToSignin : copy.signin.toggleToSignup}
      </button>
    </form>
  );
}

type FieldProps = {
  id: string;
  label: string;
  name: string;
  type: "text" | "email" | "password";
  autoComplete: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  hint?: string;
};

function Field({
  id,
  label,
  name,
  type,
  autoComplete,
  placeholder,
  required,
  minLength,
  hint,
}: FieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="font-mono text-[0.625rem] uppercase text-bulb/55"
        style={{ letterSpacing: "var(--tracking-label)" }}
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        className="
          w-full bg-transparent text-bulb
          font-body text-base
          border-0 border-b border-ash/45
          px-0 py-2
          outline-none
          placeholder:text-bulb/30 placeholder:uppercase
          placeholder:tracking-[0.04em] placeholder:font-mono
          placeholder:text-[0.75rem]
          transition-colors duration-200 ease-out-quart
          focus:border-gold
          invalid:border-ash/45
          [&:not(:placeholder-shown):invalid]:border-gold-deep
        "
      />
      {hint && (
        <p
          className="m-0 font-mono text-[0.625rem] uppercase text-bulb/45"
          style={{ letterSpacing: "var(--tracking-label)" }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
