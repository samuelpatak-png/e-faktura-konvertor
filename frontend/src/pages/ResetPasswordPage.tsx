import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { authApi, apiErrorMessage } from "../lib/api";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Alert } from "../components/ui/Alert";

export function ResetPasswordPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.resetPassword(token, newPassword);
      await refresh();
      navigate("/app", { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, "Odkaz je neplatný alebo vypršal — vyžiadaj si nový."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2 font-semibold text-ink-900">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">eF</span>
          e-Faktúra Konvertor
        </Link>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h1 className="text-lg font-semibold text-ink-900">Nastaviť nové heslo</h1>
          {!token ? (
            <div className="mt-5">
              <Alert tone="danger">Chýba odkaz na obnovenie hesla — otvor prosím odkaz z emailu.</Alert>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
              {error && <Alert tone="danger">{error}</Alert>}
              <Input
                label="Nové heslo"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                hint="Aspoň 8 znakov"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <Button type="submit" loading={loading} className="mt-2 w-full">
                Nastaviť heslo a prihlásiť sa
              </Button>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-sm text-ink-500">
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
            ← Späť na prihlásenie
          </Link>
        </p>
      </div>
    </div>
  );
}
