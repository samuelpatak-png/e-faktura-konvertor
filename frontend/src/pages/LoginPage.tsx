import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { apiErrorMessage } from "../lib/api";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Alert } from "../components/ui/Alert";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      const redirectTo = (location.state as { from?: string } | null)?.from ?? "/app";
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, "Nesprávny email alebo heslo"));
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
          <h1 className="text-lg font-semibold text-ink-900">Prihlásenie</h1>
          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="Heslo"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Link to="/forgot-password" className="-mt-2 self-end text-sm font-medium text-brand-600 hover:text-brand-700">
              Zabudnuté heslo?
            </Link>
            <Button type="submit" loading={loading} className="mt-2 w-full">
              Prihlásiť sa
            </Button>
          </form>
        </div>
        <p className="mt-4 text-center text-sm text-ink-500">
          Nemáš účet?{" "}
          <Link to="/register" className="font-medium text-brand-600 hover:text-brand-700">
            Zaregistruj sa
          </Link>
        </p>
      </div>
    </div>
  );
}
