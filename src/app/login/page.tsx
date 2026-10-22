"use client";
import { useState } from "react";
export default function Login() {
  const [error, setError] = useState("");
  return (
    <div className="page">
      <section
        className="panel"
        style={{ maxWidth: 440, margin: "10vh auto", padding: 32 }}
      >
        <span className="eyebrow">Private workspace</span>
        <h1 className="display-title">Sign in to investigate.</h1>
        <p className="muted">
          Use your provisioned account and authenticator code.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              const r = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(Object.fromEntries(f)),
              });
              const b = await r.json();
              if (!r.ok) throw Error(b.error);
              window.location.assign("/");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <label className="stack-label">
            Account
            <input
              className="input"
              name="id"
              autoComplete="username"
              required
            />
          </label>
          <label className="stack-label">
            Password
            <input
              className="input"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label className="stack-label">
            Authenticator code
            <input
              className="input mono"
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
            />
          </label>
          <button className="btn primary">Sign in</button>
          <p role="alert">{error}</p>
        </form>
      </section>
    </div>
  );
}
