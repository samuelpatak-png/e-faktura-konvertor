import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { authApi, apiErrorMessage } from "../lib/api";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Alert } from "../components/ui/Alert";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const result = await authApi.requestPasswordReset(email);
      setMessage(result.message);
    } catch (err) {
      setError(apiErrorMessage(err, "Nepodarilo sa odoslať žiadosť"));
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
          <h1 className="text-lg font-semibold text-ink-900">Zabudnuté heslo</h1>
          <p className="mt-1 text-sm text-ink-500">Pošleme ti na email odkaz na obnovenie hesla.</p>
          <div className="mt-5">
            {message ? (
              <Alert tone="success">{message}</Alert>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                {error && <Alert tone="danger">{error}</Alert>}
                <Input
                  label="Email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Button type="submit" loading={loading} className="mt-2 w-full">
                  Poslať odkaz na obnovenie
                </Button>
              </form>
            )}
          </div>
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
