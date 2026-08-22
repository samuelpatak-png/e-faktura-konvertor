# e-Faktúra Konvertor

Konvertuje PDF faktúry alebo ručne zadané údaje na validný UBL Peppol BIS 3.0 XML pre slovenskú
e-fakturáciu, s voliteľným odoslaním cez SAPI-SK do siete Peppol. Multi-tenant SaaS — každý účet
má vlastný profil firmy, históriu faktúr a SAPI-SK prístup.

## Rýchly štart

```bash
npm install

# Backend
cp backend/.env.example backend/.env
# vyplň JWT_SECRET a CREDENTIAL_ENCRYPTION_KEY (príkazy sú v komentároch v .env.example)
npm run --workspace backend prisma:migrate
npm run dev:backend      # http://localhost:4000

# Frontend (v novom termináli)
npm run dev:frontend     # http://localhost:5173
```

Frontend v dev móde proxuje `/api/*` na backend (`frontend/vite.config.ts`), takže obe bežia
lokálne bez CORS problémov a so zdieľanými cookies.

## Validácia (dvojvrstvová)

1. **`invoiceValidator.ts`** — rýchla, ľudsky čitateľná business-rule kontrola, beží pri
   každom `/invoice/validate` a `/invoice/generate` requeste v appke samotnej.
2. **Oficiálny KOSIT validátor** (EN16931 XSD + Peppol BIS Billing 3.0 Schematron,
   `itplr-kosit/validator` + `itplr-kosit/validator-configuration-bis`) — prísnejšia, oficiálna
   vrstva, beží v CI a lokálne cez:
   ```bash
   npm run --workspace backend validate:fixtures
   ```
   Potrebuje Javu 11+ (`brew install openjdk@21` na macOS — keg-only, buď pridaj
   `/opt/homebrew/opt/openjdk@21/bin` do PATH, alebo skript sám nájde tento default fallback).
   Sťahuje pinnuté verzie nástroja do `backend/tools/kosit/` (gitignored, `scripts/setup-kosit.sh`).

Tieto dve vrstvy sa **zámerne nezlučujú do jednej** — keď sa rozídu, znamená to reálnu medzeru v
`invoiceValidator.ts`, nie bug v appke. Aktuálne známy rozdiel:

- **`BR-Z-02`**: oficiálny Schematron vyžaduje Seller VAT Identifier (IČ DPH) aj pri riadku so
  sadzbou 0 % v kategórii "Zero rated" (`Z`) — teda aj pre nulovú sadzbu musí byť dodávateľ
  platca DPH. `invoiceValidator.ts` toto momentálne nekontroluje (blokuje len sadzby > 0 % bez
  IČ DPH, pozri `src/services/invoiceValidator.ts`, test `invoiceValidator.test.ts` má tento
  gap explicitne zdokumentovaný). Neplatca DPH pravdepodobne potrebuje inú kategóriu (`E`
  Exempt alebo `O` Not subject to VAT) namiesto `Z` — toto je rozhodnutie o daňovej logike,
  ktoré appka zatiaľ nerobí, a **vedome nebolo potichu opravené** (pozri WP0 handoff).

Vzorové faktúry pre CI sú v `backend/test/fixtures/` (4 scenáre: bežná tuzemská 23 %, zmiešané
sadzby, 0 % DPH s platcom, minimálna jednoriadková faktúra). Reverse charge a zahraničný
odberateľ v EÚ **nie sú** vo fixtures ani v appke podporené — pozri "Čo ešte chýba" nižšie.

## CI

`.github/workflows/ci.yml` beží na každý push/PR: backend lint + typecheck + unit testy +
Peppol validácia fixtures (Java sa provisionne cez `actions/setup-java`); frontend lint +
typecheck + build.

## Architektúra

```
backend/    Express + TypeScript, Prisma (SQLite dev), JWT auth v httpOnly cookie
frontend/   React + Vite + TypeScript + Tailwind v4
```

Kľúčové backend moduly (`backend/src/services/`):
- `xmlGenerator.ts` — generuje UBL Invoice-2 XML (Peppol BIS Billing 3.0)
- `invoiceMath.ts` — všetky sumy v centoch (žiadne float chyby), DPH počítaná per-kategória
- `invoiceValidator.ts` — business-rule validácia (BR-CO-10/14/15/17, PEPPOL-EN16931-R003)
- `pdfParser.ts` — pdf.js extrakcia textu + regex heuristiky (bez AI)
- `sapiSkClient.ts` — SAPI-SK adaptér (mock/live)

## Dôležité rozhodnutia a odchýlky od pôvodného briefu

Toto vzniklo pri stavaní appky — každý bod je zdokumentovaný aj priamo v kóde:

1. **DPH sadzby 23/19/5/0 %** (nie 20/10/0 z briefu) — Slovensko zmenilo sadzby od 1.1.2026.
   Pozri `backend/src/validators/schemas.ts`.
2. **Peppol scheme `0245` + DIČ potvrdené** ako správny slovenský participant identifier
   (overené voči docs.peppol.eu) — brief to mal správne.
3. **BuyerReference je povinné pole** (Peppol pravidlo PEPPOL-EN16931-R003), brief ho
   nespomínal — pridané do formulára aj XML.
4. ~~Žiadna reálna XSD/Schematron validácia~~ **[WP0] Doplnené.** Namiesto vlastnej XSD
   implementácie appka teraz napája oficiálny KOSIT validátor s Peppol BIS 3.0 Schematron
   pravidlami — pozri sekciu "Validácia" vyššie. Toto reálne odhalilo medzeru
   (`BR-Z-02`) v pôvodnej ručnej validácii, ktorá zostáva vedome neopravená (rozhodnutie o
   daňovej logike, čaká na projektového vlastníka).
5. **SAPI-SK adaptér je best-effort, nie overený.** SAPI-SK je reálny slovenský štandard
   (OAuth2 client_credentials → `POST /sapi/v1/document/send`), ale presný kontrakt
   (endpointy, názvy polí) pochádza z dokumentácie nájdenej počas vývoja, ktorú sa nepodarilo
   overiť voči nezávislému zdroju s istotou. **Predvolený režim je `mock`** (žiadne sieťové
   volania) — pred prepnutím na `live` v Nastaveniach si over kontrakt voči vlastným
   prihlasovacím údajom/portálu.
6. **IČO/DIČ/IČ DPH ako 3 samostatné polia**, nie len DIČ ako v brief-e — presnejšie
   zodpovedá slovenskej legislatíve.
7. **Multi-tenant SaaS s DB** namiesto pôvodne navrhovanej bezstavovej appky — používateľ si
   založí účet, uloží si profil firmy a históriu faktúr sa (rozhodnuté počas zberu požiadaviek).
   Preto sa aj SAPI-SK client secret **ukladá zašifrovane** (AES-256-GCM) v databáze namiesto
   pôvodne navrhovaného "nikdy neukladať" — pri SaaS s vlastným účtom je to očakávané správanie,
   nie bezpečnostný kompromis.
8. **TypeScript namiesto JavaScript** na oboch stranách — typová bezpečnosť pre peniaze/XML.
9. **`xmlbuilder2`** namiesto `xml2js`/`js-xml` z briefu (automaticky escapuje XML entity,
   modernejšie), **`bcryptjs`** namiesto `bcrypt` (žiadne natívne bindings, prenositeľnejšie).

## Známy nevyriešený issue

`npm audit` hlási jednu high-severity zraniteľnosť (`deepmerge-ts` cez `@prisma/config`) — je to
len v Prisma CLI (generate/migrate), nie v bežiacej appke. Znovu overené vo WP0 (2026-08-19,
Prisma 6.19.3 aj `npm audit fix`) — stále bez opravy upstream. Skontroluj `npm audit` po
budúcich `npm update`.

WP7 (2026-08-20) pridal `mailparser` ako devDependency (parsovanie zachytených emailov v
testoch, pozri `emailSender.test.ts`) — ten ťahá tú istú `deepmerge-ts` reťaz cez
`html-to-text`. Nová cesta k tej istej už zdokumentovanej zraniteľnosti, nie nová
zraniteľnosť — a opäť len v testoch, nie v bežiacej appke.

## Čo ešte chýba pred produkciou

- Reálne SAPI-SK prihlasovacie údaje a potvrdenie kontraktu (bod 5 vyššie)
- Nasadenie (frontend napr. Vercel, backend napr. Railway + Postgres namiesto SQLite —
  zmena je len v `backend/prisma/schema.prisma` datasource provider + `DATABASE_URL`)
- **Rozhodnutie o `BR-Z-02`** (pozri "Validácia" vyššie) — či neplatca DPH môže vôbec vystaviť
  0%-nú položku, a ak áno, pod akou tax category (`E`/`O`, nie `Z`)
- Reverse charge (`AE`) a zahraničný odberateľ v EÚ — mimo rozsahu WP0, generátor aj schéma sú
  zámerne obmedzené na tuzemské SK-SK faktúry (viď bod vyššie)
- Overiť RPO lookup (IČO autofill) proti reálnej prevádzke — V1 API sa počas vývoja správalo
  nespoľahlivo, appka to už rozlišuje ako `unavailable` (nie tiché "nenašlo sa"), ale samotná
  spoľahlivosť zdroja zostáva neoverená
- SPF/DKIM pre doménu, z ktorej appka posiela faktúry/upomienky zákazníkom — inak riziko spamu
- Právne stránky (Obchodné podmienky, GDPR/Ochrana osobných údajov) — landing page na ne zatiaľ
  neodkazuje

## Produkčné náležitosti — heslo, rate limiting, monitoring

Doplnené mimo pôvodných WP0–WP7 (2026-08-22), na žiadosť projektového vlastníka:

- **Zabudnuté heslo + overenie emailu.** `POST /auth/request-password-reset` /
  `POST /auth/reset-password` / `POST /auth/request-verification` / `POST /auth/verify-email`.
  Overenie emailu je **len informatívny badge** v appke (banner s "Poslať overovací email
  znova"), nič v appke naň nie je naviazané ako gate — malá firma sa nemá prečo zaseknúť na
  flaky emaile pri fakturačnom nástroji. Oba flow potrebujú vlastné systémové SMTP (odlišné od
  per-tenant SMTP vo firemných Nastaveniach) — vyplň `APP_SMTP_*` v `.env`
  (`backend/.env.example`). Bez toho appka funguje ďalej normálne, tieto dva requesty len
  potichu zlyhajú (zalogujú chybu na serveri, klientovi odpovedia generickou správou).
- **Rate limiting.** `express-rate-limit` na `/auth/login`, `/auth/register`,
  `/auth/request-password-reset`, `/auth/reset-password`, `/auth/request-verification`,
  `/auth/verify-email` — 10 requestov / 15 min / IP (`backend/src/middleware/rateLimit.ts`).
- **Sentry.** `@sentry/node` (backend, `backend/src/instrument.ts`) a `@sentry/react`
  (frontend, `frontend/src/instrument.ts`) — obe úplne neaktívne, kým nevyplníš `SENTRY_DSN`
  (backend `.env`) / `VITE_SENTRY_DSN` (frontend `.env`). Nevyžaduje žiadny Sentry účet na to,
  aby appka bežala — je to čisto voliteľné.
