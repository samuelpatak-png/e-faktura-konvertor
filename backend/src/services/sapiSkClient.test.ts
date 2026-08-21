import { afterEach, describe, expect, it, vi } from "vitest";

// SAPI-SK is a real third-party service with no local test double — mocked at the axios
// boundary so the "live" payload can be inspected directly, without a real network call.
vi.mock("axios", () => ({
  default: { post: vi.fn() },
}));

import axios from "axios";
import { sendInvoiceViaSapiSk } from "./sapiSkClient";

const mockedPost = vi.mocked(axios.post);

afterEach(() => {
  mockedPost.mockReset();
});

function mockTokenAndSend() {
  mockedPost.mockImplementation(async (url: string) => {
    if (url.includes("/auth/token")) {
      return { data: { access_token: "test-token", expires_in: 3600 } };
    }
    if (url.includes("/document/send")) {
      return { data: { providerDocumentId: "doc-1", status: "ACCEPTED" } };
    }
    throw new Error(`unexpected URL in test: ${url}`);
  });
}

function findSendCall() {
  return mockedPost.mock.calls.find(([url]) => (url as string).includes("/document/send"));
}

const baseParams = {
  senderParticipantId: "0245:1111111111",
  receiverParticipantId: "0245:2222222222",
  documentId: "2026-0001",
  xml: "<Invoice/>",
};

describe("sendInvoiceViaSapiSk", () => {
  it("mock mode never calls axios at all, regardless of documentType", async () => {
    const result = await sendInvoiceViaSapiSk({ ...baseParams, clientId: "c", clientSecret: "s", mode: "mock", documentType: "CREDIT_NOTE" });
    expect(result.mock).toBe(true);
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("uses the Invoice-2 documentTypeId for documentType INVOICE", async () => {
    mockTokenAndSend();
    await sendInvoiceViaSapiSk({ ...baseParams, clientId: "c1", clientSecret: "s1", mode: "live", documentType: "INVOICE" });
    const sendCall = findSendCall();
    expect(sendCall).toBeDefined();
    const payload = sendCall![1] as { metadata: { documentTypeId: string } };
    expect(payload.metadata.documentTypeId).toContain("urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice");
    expect(payload.metadata.documentTypeId).not.toContain("CreditNote");
  });

  // Regression: documentTypeId was hardcoded to the Invoice-2 identifier regardless of what was
  // actually being sent — a credit note went out over SAPI-SK tagged as an Invoice.
  it("uses the CreditNote-2 documentTypeId for documentType CREDIT_NOTE", async () => {
    mockTokenAndSend();
    await sendInvoiceViaSapiSk({ ...baseParams, clientId: "c2", clientSecret: "s2", mode: "live", documentId: "DB-2026-0001", documentType: "CREDIT_NOTE", xml: "<CreditNote/>" });
    const sendCall = findSendCall();
    expect(sendCall).toBeDefined();
    const payload = sendCall![1] as { metadata: { documentTypeId: string } };
    expect(payload.metadata.documentTypeId).toContain("urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote");
  });

  it("still uses the Invoice-2 documentTypeId for an ADVANCE_TAX_DOCUMENT (386) — it's still a plain <Invoice> root", async () => {
    mockTokenAndSend();
    await sendInvoiceViaSapiSk({ ...baseParams, clientId: "c3", clientSecret: "s3", mode: "live", documentType: "ADVANCE_TAX_DOCUMENT" });
    const sendCall = findSendCall();
    const payload = sendCall![1] as { metadata: { documentTypeId: string } };
    expect(payload.metadata.documentTypeId).toContain("urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice");
  });

  it("CreditNote and Invoice documentTypeIds share the same CustomizationID/ProfileID suffix", async () => {
    mockTokenAndSend();
    await sendInvoiceViaSapiSk({ ...baseParams, clientId: "c4", clientSecret: "s4", mode: "live", documentType: "INVOICE" });
    const invoicePayload = findSendCall()![1] as { metadata: { documentTypeId: string } };
    mockedPost.mockClear();

    mockTokenAndSend();
    await sendInvoiceViaSapiSk({ ...baseParams, clientId: "c5", clientSecret: "s5", mode: "live", documentType: "CREDIT_NOTE", xml: "<CreditNote/>" });
    const creditNotePayload = findSendCall()![1] as { metadata: { documentTypeId: string } };

    const suffix = "##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
    expect(invoicePayload.metadata.documentTypeId.endsWith(suffix)).toBe(true);
    expect(creditNotePayload.metadata.documentTypeId.endsWith(suffix)).toBe(true);
  });
});
