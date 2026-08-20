// bysquare's package.json declares "./pay" only via an `exports` map, which this project's
// tsconfig `moduleResolution: "Node"` (legacy) can't statically resolve. Upgrading
// moduleResolution to "bundler" or "node16" was tried and rejected: both require changing
// `module` away from "CommonJS" too, which is a much larger, riskier change to how the whole
// backend compiles — not something to do for one dependency. This shim declares only the
// subset of the real API (node_modules/bysquare/lib/pay/types.d.ts) that this project actually
// uses, copied accurately from that file rather than typed as `any`.
//
// Note this is a type-only shim: at runtime, bysquare/pay actually has to be loaded via a
// dynamic-import indirection, not a plain `require()`/static `import` — see the top of
// services/paymentQr.ts for why (Node's CJS loader can't resolve bysquare's own ESM-only
// "lzma1" dependency). An earlier version of this comment claimed plain `require()` worked at
// runtime "regardless" — that was wrong, only verified under Vitest's own module resolution,
// and the real dev server crashed on it. Corrected after actually starting the server.
declare module "bysquare/pay" {
  export interface BankAccount {
    iban: string;
    bic?: string;
  }

  export interface Beneficiary {
    name: string;
    street?: string;
    city?: string;
  }

  export const PaymentOptions: {
    readonly PaymentOrder: 1;
    readonly StandingOrder: 2;
    readonly DirectDebit: 4;
  };
  export type PaymentOptions = (typeof PaymentOptions)[keyof typeof PaymentOptions];

  export const CurrencyCode: {
    readonly EUR: "EUR";
    readonly USD: "USD";
    readonly [code: string]: string;
  };
  export type CurrencyCode = (typeof CurrencyCode)[keyof typeof CurrencyCode];

  export interface SimplePayment {
    amount?: number;
    currencyCode: string | CurrencyCode;
    paymentDueDate?: string;
    variableSymbol?: string;
    constantSymbol?: string;
    specificSymbol?: string;
    originatorsReferenceInformation?: string;
    paymentNote?: string;
    bankAccounts: BankAccount[];
    beneficiary: Beneficiary;
  }

  export type PaymentOrder = SimplePayment & { type: typeof PaymentOptions.PaymentOrder };

  export interface DataModel {
    invoiceId?: string;
    payments: PaymentOrder[];
  }

  export interface EncodeOptions {
    deburr?: boolean;
  }

  export function encode(data: DataModel, options?: EncodeOptions): string;
  export function decode(qrString: string): DataModel;
}
