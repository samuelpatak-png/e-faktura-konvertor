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
4. **Žiadna reálna XSD/Schematron validácia.** Namiesto sťahovania a napájania celého UBL 2.1
   XSD stromu (viacero previazaných súborov) je tu vlastná, ručne písaná štruktúrna a
   business-rule validácia (`invoiceValidator.ts`). Pokrýva to, čo appka sama generuje, ale
   **pred ostrým nasadením odporúčam prehnať pár vzorových faktúr cez oficiálny
   Peppol/EN16931 validátor** (napr. e-invoice.be/peppol-validator), aby si to niekto nezávisle
   potvrdil.
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
len v Prisma CLI (generate/migrate), nie v bežiacej appke, a k dátumu písania tohto README ju
nemá opravenú ani najnovší Prisma release. Skontroluj `npm audit` po budúcich `npm update`.

## Čo ešte chýba pred produkciou

- Reálne SAPI-SK prihlasovacie údaje a potvrdenie kontraktu (bod 5 vyššie)
- Nasadenie (frontend napr. Vercel, backend napr. Railway + Postgres namiesto SQLite —
  zmena je len v `backend/prisma/schema.prisma` datasource provider + `DATABASE_URL`)
- Nezávislá kontrola vygenerovaného XML cez oficiálny Peppol validátor
