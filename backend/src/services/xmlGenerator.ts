import { create } from "xmlbuilder2";
import { centsToEur } from "./invoiceMath";
import type { ComputedLine, TaxCategoryBreakdown } from "./invoiceMath";

const CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";
const PROFILE_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const SK_PEPPOL_SCHEME = "0245"; // Slovakia: scheme 0245 + 10-digit DIČ (verified against docs.peppol.eu)
const INVOICE_TYPE_CODE = "380"; // UNCL1001: commercial invoice

export interface PartyDetails {
  name: string;
  ico?: string | null;
  dic: string;
  icDph?: string | null;
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface GenerateInvoiceXmlInput {
  number: string;
  issueDate: string;
  dueDate: string;
  buyerReference: string;
  currency: string;
  supplier: PartyDetails & { iban: string; bic?: string | null };
  customer: PartyDetails;
  lines: ComputedLine[];
  netAmountCents: number;
  taxAmountCents: number;
  grossAmountCents: number;
  taxBreakdown: TaxCategoryBreakdown[];
}

function taxCategoryId(ratePercent: number): "S" | "Z" {
  // "Z" = zero-rated (still a taxable supply, just at 0%). Exemptions for other reasons
  // (category "E", intra-community "K", reverse charge "AE", etc.) aren't in MVP scope —
  // this app targets standard domestic SK B2B invoices per the brief.
  return ratePercent === 0 ? "Z" : "S";
}

function buildParty(doc: ReturnType<typeof create>, party: PartyDetails) {
  const partyEl = doc.ele("cac:Party");

  partyEl.ele("cbc:EndpointID", { schemeID: SK_PEPPOL_SCHEME }).txt(party.dic);

  partyEl
    .ele("cac:PartyIdentification")
    .ele("cbc:ID", { schemeID: SK_PEPPOL_SCHEME })
    .txt(party.dic)
    .up()
    .up();

  partyEl.ele("cac:PartyName").ele("cbc:Name").txt(party.name).up().up();

  const address = partyEl.ele("cac:PostalAddress");
  address.ele("cbc:StreetName").txt(party.street).up();
  address.ele("cbc:CityName").txt(party.city).up();
  address.ele("cbc:PostalZone").txt(party.postalCode).up();
  address.ele("cac:Country").ele("cbc:IdentificationCode").txt(party.country).up().up();
  address.up();

  if (party.icDph) {
    const taxScheme = partyEl.ele("cac:PartyTaxScheme");
    taxScheme.ele("cbc:CompanyID").txt(party.icDph).up();
    taxScheme.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
    taxScheme.up();
  }

  const legalEntity = partyEl.ele("cac:PartyLegalEntity");
  legalEntity.ele("cbc:RegistrationName").txt(party.name).up();
  legalEntity.ele("cbc:CompanyID", { schemeID: SK_PEPPOL_SCHEME }).txt(party.ico ?? party.dic).up();
  legalEntity.up();

  partyEl.up();
}

/**
 * Generates a UBL 2.1 Invoice compliant with Peppol BIS Billing 3.0 (element order follows
 * the UBL XSD sequence deliberately, since a validator will reject out-of-order elements
 * even when every required element is present).
 */
export function generateInvoiceXml(input: GenerateInvoiceXmlInput): string {
  const doc = create({ version: "1.0", encoding: "UTF-8" }).ele("Invoice", {
    xmlns: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    "xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  });

  doc.ele("cbc:UBLVersionID").txt("2.1").up();
  doc.ele("cbc:CustomizationID").txt(CUSTOMIZATION_ID).up();
  doc.ele("cbc:ProfileID").txt(PROFILE_ID).up();
  doc.ele("cbc:ID").txt(input.number).up();
  doc.ele("cbc:IssueDate").txt(input.issueDate).up();
  doc.ele("cbc:DueDate").txt(input.dueDate).up();
  doc.ele("cbc:InvoiceTypeCode").txt(INVOICE_TYPE_CODE).up();
  doc.ele("cbc:DocumentCurrencyCode").txt(input.currency).up();
  doc.ele("cbc:BuyerReference").txt(input.buyerReference).up();

  buildParty(doc.ele("cac:AccountingSupplierParty"), input.supplier);
  doc.up();
  buildParty(doc.ele("cac:AccountingCustomerParty"), input.customer);
  doc.up();

  const paymentMeans = doc.ele("cac:PaymentMeans");
  paymentMeans.ele("cbc:PaymentMeansCode", { name: "Credit transfer" }).txt("30").up();
  paymentMeans.ele("cbc:PaymentID").txt(input.number).up();
  const account = paymentMeans.ele("cac:PayeeFinancialAccount");
  account.ele("cbc:ID").txt(input.supplier.iban).up();
  if (input.supplier.bic) {
    account.ele("cac:FinancialInstitutionBranch").ele("cbc:ID").txt(input.supplier.bic).up().up();
  }
  account.up();
  paymentMeans.up();

  const taxTotal = doc.ele("cac:TaxTotal");
  taxTotal.ele("cbc:TaxAmount", { currencyID: input.currency }).txt(centsToEur(input.taxAmountCents).toFixed(2)).up();
  for (const bracket of input.taxBreakdown) {
    const subtotal = taxTotal.ele("cac:TaxSubtotal");
    subtotal.ele("cbc:TaxableAmount", { currencyID: input.currency }).txt(centsToEur(bracket.taxableAmountCents).toFixed(2)).up();
    subtotal.ele("cbc:TaxAmount", { currencyID: input.currency }).txt(centsToEur(bracket.taxAmountCents).toFixed(2)).up();
    const category = subtotal.ele("cac:TaxCategory");
    category.ele("cbc:ID").txt(taxCategoryId(bracket.taxRatePercent)).up();
    category.ele("cbc:Percent").txt(bracket.taxRatePercent.toFixed(2)).up();
    category.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
    category.up();
    subtotal.up();
  }
  taxTotal.up();

  const monetaryTotal = doc.ele("cac:LegalMonetaryTotal");
  monetaryTotal.ele("cbc:LineExtensionAmount", { currencyID: input.currency }).txt(centsToEur(input.netAmountCents).toFixed(2)).up();
  monetaryTotal.ele("cbc:TaxExclusiveAmount", { currencyID: input.currency }).txt(centsToEur(input.netAmountCents).toFixed(2)).up();
  monetaryTotal.ele("cbc:TaxInclusiveAmount", { currencyID: input.currency }).txt(centsToEur(input.grossAmountCents).toFixed(2)).up();
  monetaryTotal.ele("cbc:PayableAmount", { currencyID: input.currency }).txt(centsToEur(input.grossAmountCents).toFixed(2)).up();
  monetaryTotal.up();

  for (const line of input.lines) {
    const lineEl = doc.ele("cac:InvoiceLine");
    lineEl.ele("cbc:ID").txt(String(line.sortOrder + 1)).up();
    lineEl.ele("cbc:InvoicedQuantity", { unitCode: line.unitCode }).txt(String(line.quantity)).up();
    lineEl.ele("cbc:LineExtensionAmount", { currencyID: input.currency }).txt(centsToEur(line.lineNetCents).toFixed(2)).up();

    const item = lineEl.ele("cac:Item");
    item.ele("cbc:Name").txt(line.description).up();
    const classifiedTax = item.ele("cac:ClassifiedTaxCategory");
    classifiedTax.ele("cbc:ID").txt(taxCategoryId(line.taxRatePercent)).up();
    classifiedTax.ele("cbc:Percent").txt(line.taxRatePercent.toFixed(2)).up();
    classifiedTax.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
    classifiedTax.up();
    item.up();

    const price = lineEl.ele("cac:Price");
    price.ele("cbc:PriceAmount", { currencyID: input.currency }).txt(centsToEur(line.unitPriceCents).toFixed(2)).up();
    price.up();

    lineEl.up();
  }

  return doc.end({ prettyPrint: true });
}
