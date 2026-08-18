import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";

const FEATURES = [
  {
    title: "PDF alebo ručne",
    description: "Nahraj existujúcu PDF faktúru na predvyplnenie údajov, alebo ich zadaj ručne cez prehľadný formulár.",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    ),
  },
  {
    title: "Peppol BIS 3.0",
    description: "Generuje validný UBL XML presne podľa slovenskej Peppol schémy (0245 + DIČ), pripravený na sieť Peppol.",
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />,
  },
  {
    title: "Presná DPH kalkulácia",
    description: "Aktuálne sadzby 23/19/5/0 %, výpočet v centoch bez zaokrúhľovacích chýb, súlad s pravidlami BR-CO-14/15/17.",
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33" />,
  },
  {
    title: "Dvojité potvrdenie",
    description: "Faktúra sa vygeneruje až po tom, čo si skontroluješ súhrn, XML náhľad a potvrdíš dvomi checkboxami.",
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  },
  {
    title: "Odoslanie cez SAPI-SK",
    description: "Priame odoslanie do siete Peppol cez digitálneho poštára, alebo stiahnutie XML na neskoršie použitie.",
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />,
  },
  {
    title: "História a prehľad",
    description: "Každá vygenerovaná faktúra sa uloží — vidíš stav, sumu aj históriu odoslaní na jednom mieste.",
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />,
  },
];

const STEPS = [
  { title: "Nahraj alebo zadaj", description: "PDF faktúru necháš predvyplniť, alebo vyplníš údaje ručne." },
  { title: "Skontroluj a potvrď", description: "Pozrieš si súhrn aj XML náhľad, potvrdíš dvomi checkboxami." },
  { title: "Stiahni alebo odošli", description: "Stiahneš XML súbor, alebo ho pošleš rovno cez SAPI-SK do siete Peppol." },
];

export function LandingPage() {
  return (
    <div className="bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2 font-semibold text-ink-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">eF</span>
            e-Faktúra Konvertor
          </div>
          <div className="flex items-center gap-2">
            <Link to="/login">
              <Button variant="ghost">Prihlásiť sa</Button>
            </Link>
            <Link to="/register">
              <Button>Registrovať zdarma</Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">
            Peppol e-fakturácia povinná od 1. 1. 2027
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
            Z PDF alebo formulára rovno na <span className="text-brand-600">validnú e-faktúru</span>
          </h1>
          <p className="mt-4 text-lg text-ink-500">
            Konvertuj faktúry do formátu UBL Peppol BIS 3.0 bez AI a bez cloudu. Skontroluj, potvrď a stiahni alebo odošli
            priamo do siete Peppol cez SAPI-SK.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/register">
              <Button size="lg">Začať zadarmo</Button>
            </Link>
            <Link to="/login">
              <Button size="lg" variant="secondary">
                Už mám účet
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-sm text-ink-500">
            Dobrovoľná fáza beží od 1. 1. 2026 — over si Peppol e-fakturáciu ešte pred povinným termínom.
          </p>
        </div>
      </section>

      <section className="border-y border-line bg-surface py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold text-ink-900 sm:text-3xl">Všetko, čo potrebuješ na e-fakturáciu</h2>
            <p className="mt-3 text-ink-500">Lokálne spracovanie, presná validácia a priame napojenie na Peppol sieť.</p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                    {f.icon}
                  </svg>
                </div>
                <h3 className="mt-4 font-semibold text-ink-900">{f.title}</h3>
                <p className="mt-1.5 text-sm text-ink-500">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-semibold text-ink-900 sm:text-3xl">Ako to funguje</h2>
          <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.title} className="text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 font-semibold text-white">
                  {i + 1}
                </div>
                <h3 className="mt-4 font-semibold text-ink-900">{step.title}</h3>
                <p className="mt-1.5 text-sm text-ink-500">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Intentionally always-dark band regardless of site theme — bg-neutral-900 (fixed),
          not the ink-900 token (which flips to white in dark mode). */}
      <section className="border-t border-line bg-neutral-900 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl px-4 text-center sm:px-6">
          <h2 className="text-2xl font-semibold text-white sm:text-3xl">Priprav sa na povinnú e-fakturáciu</h2>
          <p className="mt-3 text-slate-300">Zaregistruj sa zadarmo a vyskúšaj konverziu na svojich vlastných faktúrach.</p>
          <div className="mt-8">
            <Link to="/register">
              <Button size="lg" variant="accent">
                Registrovať zadarmo
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-line bg-surface py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-ink-500 sm:px-6">
          e-Faktúra Konvertor — nezávislý nástroj pre konverziu do UBL Peppol BIS 3.0. Nie je súčasťou Finančnej správy SR.
        </div>
      </footer>
    </div>
  );
}
