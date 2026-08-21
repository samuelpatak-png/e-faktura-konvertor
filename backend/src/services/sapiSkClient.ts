import axios from "axios";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { env } from "../lib/env";

/**
 * SAPI-SK is a real Slovak standard (OAuth2 client_credentials + POST /document/send for
 * UBL Peppol documents), but this implementation is built from documentation gathered
 * during development that could not be verified against a primary/authoritative source in
 * this session. Treat the "live" path as a best-effort draft: confirm exact field names,
 * endpoints and error shapes against your own SAPI-SK portal/credentials before relying on
 * it for real sends. "mock" mode (the default) makes no network calls at all.
 */

export interface SapiSkSendParams {
  clientId: string;
  clientSecret: string;
  mode: "mock" | "live";
  senderParticipantId: string; // "0245:<supplier DIČ>"
  receiverParticipantId: string; // "0245:<customer DIČ>"
  documentId: string; // invoice number
  // Selects the Peppol documentTypeId's root element below. ADVANCE_TAX_DOCUMENT (386) is still
  // a plain UBL <Invoice> root (see xmlGenerator.ts generateInvoiceXml) — only CREDIT_NOTE uses
  // the CreditNote-2 identifier.
  documentType: "INVOICE" | "CREDIT_NOTE" | "ADVANCE_TAX_DOCUMENT";
  xml: string;
}

const INVOICE_DOCUMENT_TYPE_ID =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
// Same CustomizationID/ProfileID as Invoice-2 (see xmlGenerator.ts's CUSTOMIZATION_ID comment —
// verified against the official Peppol BIS 3.0.21 Schematron); only the root element differs.
const CREDIT_NOTE_DOCUMENT_TYPE_ID =
  "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";

export interface SapiSkSendResult {
  success: boolean;
  mock: boolean;
  providerDocumentId?: string;
  status?: string;
  error?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

// Cache key includes a hash of the secret, not just clientId, so a cache hit can only ever
// come from a caller who actually supplied the matching secret — clientId alone (a public-ish
// identifier, not a credential) must never be enough to receive someone else's cached token.
function cacheKey(clientId: string, clientSecret: string): string {
  const secretHash = crypto.createHash("sha256").update(clientSecret).digest("hex");
  return `${clientId}:${secretHash}`;
}

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const key = cacheKey(clientId, clientSecret);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 5_000) {
    return cached.accessToken;
  }

  const response = await axios.post(`${env.SAPI_SK_BASE_URL}/v1/auth/token`, {
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const { access_token, expires_in } = response.data;
  tokenCache.set(key, { accessToken: access_token, expiresAt: Date.now() + expires_in * 1000 });
  return access_token;
}

export async function sendInvoiceViaSapiSk(params: SapiSkSendParams): Promise<SapiSkSendResult> {
  // Fail-closed: only the exact value "live" reaches the network path below. Anything else
  // (an absent/null/typo'd mode from a future call site) falls back to the safe mock response,
  // rather than the network path being the default and "mock" the special case.
  if (params.mode !== "live") {
    return {
      success: true,
      mock: true,
      providerDocumentId: `mock-${uuidv4()}`,
      status: "MOCK_ACCEPTED",
    };
  }

  try {
    const accessToken = await getAccessToken(params.clientId, params.clientSecret);
    const checksum = crypto.createHash("sha256").update(params.xml, "utf8").digest("hex");

    const response = await axios.post(
      `${env.SAPI_SK_BASE_URL}/v1/document/send`,
      {
        metadata: {
          documentId: params.documentId,
          documentTypeId: params.documentType === "CREDIT_NOTE" ? CREDIT_NOTE_DOCUMENT_TYPE_ID : INVOICE_DOCUMENT_TYPE_ID,
          processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
          senderParticipantId: params.senderParticipantId,
          receiverParticipantId: params.receiverParticipantId,
          creationDateTime: new Date().toISOString(),
        },
        payload: params.xml,
        payloadFormat: "XML",
        payloadEncoding: "UTF-8",
        checksum,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Peppol-Participant-Id": params.senderParticipantId,
          "Idempotency-Key": uuidv4(),
          "Content-Type": "application/json",
        },
        timeout: 30_000,
      }
    );

    return {
      success: true,
      mock: false,
      providerDocumentId: response.data.providerDocumentId,
      status: response.data.status,
    };
  } catch (err: any) {
    const message: string =
      err?.response?.data?.error?.message ?? err?.message ?? "Neznáma chyba pri odosielaní cez SAPI-SK";
    return { success: false, mock: false, error: message };
  }
}
