import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { authApi, apiErrorMessage } from "../lib/api";
import { Alert } from "../components/ui/Alert";
import { FullPageSpinner } from "../components/ui/Spinner";

export function VerifyEmailPage() {
  const { user, refresh } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("error");
      setError("Chýba odkaz na overenie emailu — otvor prosím odkaz z emailu.");
      return;
    }
    authApi
      .verifyEmail(token)
      .then(async () => {
        setState("done");
        // Only meaningful if the browser that clicked the link is also logged in — refresh()
        // silently no-ops (sets user to null) otherwise, which is fine here.
        if (user) await refresh();
      })
      .catch((err) => {
        setState("error");
        setError(apiErrorMessage(err, "Odkaz na overenie emailu je neplatný alebo vypršal."));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2 font-semibold text-ink-900">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">eF</span>
          e-Faktúra Konvertor
        </Link>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h1 className="text-lg font-semibold text-ink-900">Overenie emailu</h1>
          <div className="mt-5">
            {state === "loading" && <FullPageSpinner />}
            {state === "done" && <Alert tone="success">Email bol úspešne overený.</Alert>}
            {state === "error" && <Alert tone="danger">{error}</Alert>}
          </div>
        </div>
        <p className="mt-4 text-center text-sm text-ink-500">
          <Link to={user ? "/app" : "/login"} className="font-medium text-brand-600 hover:text-brand-700">
            {user ? "Pokračovať do appky" : "Prihlásiť sa"}
          </Link>
        </p>
      </div>
    </div>
  );
}
