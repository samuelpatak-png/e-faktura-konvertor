import { XMLParser } from "fast-xml-parser";
import { eurToCents } from "./invoiceMath";

export interface ParsedParty {
  name: string;
  ico: string | null;
  dic: string | null;
  icDph: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface ParsedLine {
  description: string;
  quantity: number;
  unitCode: string;
  unitPriceCents: number;
  taxRatePercent: number;
  lineNetCents: number;
}

export interface ParsedUblDocument {
  documentType: "INVOICE" | "CREDIT_NOTE";
  number: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  buyerReference: string | null;
  supplier: ParsedParty;
  customer: ParsedParty;
  lines: ParsedLine[];
  netAmountCents: number;
  taxAmountCents: number;
  grossAmountCents: number;
}

export class UblParseError extends Error {}

// A real EN16931 invoice, even with many lines, is normally well under 1MB — this is a
// generous ceiling against "obrovský súbor" hostile-input uploads, checked before the parser
// (which has no internal limit of its own) ever touches the content.
const MAX_XML_BYTES = 5 * 1024 * 1024;

// ignoreAttributes/attributeNamePrefix: keep schemeID etc. accessible (@_unitCode).
// parseTagValue/parseAttributeValue: false — WITHOUT this, fast-xml-parser silently coerces
// numeric-looking text to JS numbers, which would corrupt PSČ/DIČ/ID values with leading
// zeros (e.g. "04001" -> 4001). Verified this actually happens against a real fixture before
// picking this option.
// External-entity (XXE) and internal-entity-expansion (billion laughs) safety was verified
// empirically against this exact parser/version before choosing it — see WP5 handoff. It
// throws outright on any DOCTYPE/ENTITY rather than silently ignoring or expanding one.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // TaxTotal/PartyTaxScheme/PartyIdentification are usually singular but legally can repeat
  // (e.g. a second cac:TaxTotal for a tax currency alongside the document currency — BG-13; a
  // party can carry more than one PartyIdentification with different schemeIDs). Without being
  // forced into an array even for the common single-occurrence case, fast-xml-parser only
  // auto-arrays when it *actually* sees 2+ occurrences — so code reading these as a single node
  // would work for every fixture we generate ourselves and then silently break on a real
  // multi-occurrence document from someone else's system. firstOf() below always takes the
  // first (document-currency / primary) one.
  isArray: (name) => ["cac:InvoiceLine", "cac:CreditNoteLine", "cac:TaxSubtotal", "cac:TaxTotal", "cac:PartyTaxScheme", "cac:PartyIdentification"].includes(name),
});

type Node = string | number | boolean | { [key: string]: Node } | undefined | null;

function text(node: Node): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === "string") return node.trim() || null;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (typeof node === "object" && "#text" in node) {
    const v = (node as Record<string, Node>)["#text"];
    return text(v);
  }
  return null;
}

function num(node: Node): number | null {
  const t = text(node);
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function attr(node: Node, name: string): string | null {
  if (node && typeof node === "object") {
    return text((node as Record<string, Node>)[name]);
  }
  return null;
}

function child(node: Node, key: string): Node {
  if (node && typeof node === "object") return (node as Record<string, Node>)[key];
  return undefined;
}

/** Picks the first element out of a node that `isArray` may have forced into an array (or that
 * fast-xml-parser auto-arrayed because the source XML actually repeated the tag) — the element
 * itself, unchanged, when it wasn't an array to begin with. */
function firstOf(node: Node): Node {
  return Array.isArray(node) ? node[0] : node;
}

/** Finds a root-level child by local name, ignoring any namespace prefix (e.g. matches both
 * `Invoice` and a prefixed `ns3:Invoice` — some senders/APs prefix the default namespace). */
function findByLocalName(node: Node, localName: string): Node {
  if (!node || typeof node !== "object") return undefined;
  for (const key of Object.keys(node as Record<string, Node>)) {
    const bareName = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
    if (bareName === localName) return (node as Record<string, Node>)[key];
  }
  return undefined;
}

function parseParty(partyWrapper: Node): ParsedParty {
  const party = child(partyWrapper, "cac:Party");
  const legalEntity = child(party, "cac:PartyLegalEntity");
  // firstOf: a party can legally carry more than one PartyTaxScheme/PartyIdentification (see
  // the isArray comment above) — we only ever need the primary one of each.
  const taxScheme = firstOf(child(party, "cac:PartyTaxScheme"));
  const address = child(party, "cac:PostalAddress");
  const partyName = text(child(child(party, "cac:PartyName"), "cbc:Name")) ?? text(child(legalEntity, "cbc:RegistrationName"));

  // DIČ / Peppol participant ID: real-world senders use either PartyIdentification/ID or
  // EndpointID for this — both are seen in practice, so try both rather than assuming ours.
  const partyId = text(child(firstOf(child(party, "cac:PartyIdentification")), "cbc:ID")) ?? text(child(party, "cbc:EndpointID"));

  return {
    name: partyName ?? "(neznámy názov)",
    // PartyLegalEntity/CompanyID: senders vary on whether this holds an IČO or a DIČ-like
    // value (we ourselves put IČO here when generating, falling back to DIČ) — extracted
    // best-effort, not strictly validated as an 8-digit SK IČO, since this document may not
    // even be from a Slovak sender.
    ico: text(child(legalEntity, "cbc:CompanyID")),
    dic: partyId,
    icDph: taxScheme ? text(child(taxScheme, "cbc:CompanyID")) : null,
    street: text(child(address, "cbc:StreetName")),
    city: text(child(address, "cbc:CityName")),
    postalCode: text(child(address, "cbc:PostalZone")),
    country: text(child(child(address, "cac:Country"), "cbc:IdentificationCode")),
  };
}

function parseLines(lineNodes: Node[], quantityField: string): ParsedLine[] {
  return lineNodes.map((line) => {
    const item = child(line, "cac:Item");
    const classifiedTax = child(item, "cac:ClassifiedTaxCategory");
    const priceAmount = num(child(child(line, "cac:Price"), "cbc:PriceAmount")) ?? 0;
    const quantityNode = child(line, quantityField);
    return {
      description: text(child(item, "cbc:Name")) ?? "(bez popisu)",
      quantity: num(quantityNode) ?? 0,
      unitCode: attr(quantityNode, "@_unitCode") ?? "C62",
      unitPriceCents: eurToCents(priceAmount),
      taxRatePercent: num(child(classifiedTax, "cbc:Percent")) ?? 0,
      lineNetCents: eurToCents(num(child(line, "cbc:LineExtensionAmount")) ?? 0),
    };
  });
}

/**
 * Parses an uploaded UBL 2.1 Invoice or CreditNote into a normalized shape for the human-
 * readable preview (see WP5 handoff for what's covered vs. best-effort). Never trusts the
 * input to be well-formed or even genuinely UBL — throws UblParseError with a Slovak message
 * for anything it can't make sense of, and never lets a malformed/hostile file crash the
 * process (XXE and entity-expansion safety is a property of the underlying parser, verified
 * separately — see the `parser` config comment above).
 */
export function parseUblDocument(xmlContent: string): ParsedUblDocument {
  if (Buffer.byteLength(xmlContent, "utf8") > MAX_XML_BYTES) {
    throw new UblParseError(`Súbor je príliš veľký (limit ${MAX_XML_BYTES / 1024 / 1024} MB).`);
  }

  let root: Node;
  try {
    root = parser.parse(xmlContent);
  } catch (err) {
    throw new UblParseError(`Neplatné alebo poškodené XML: ${err instanceof Error ? err.message : String(err)}`);
  }

  // findByLocalName, not a bare child() lookup — some senders/APs emit a namespace-prefixed
  // root (e.g. <ns3:Invoice>), which a plain "Invoice" key lookup would miss entirely and
  // reject as "not a valid UBL document" despite being one.
  const invoice = findByLocalName(root, "Invoice");
  const creditNote = findByLocalName(root, "CreditNote");
  if (!invoice && !creditNote) {
    throw new UblParseError("Súbor nie je platný UBL dokument — chýba koreňový element <Invoice> alebo <CreditNote>.");
  }
  const documentType: "INVOICE" | "CREDIT_NOTE" = invoice ? "INVOICE" : "CREDIT_NOTE";
  const doc = invoice ?? creditNote;

  const number = text(child(doc, "cbc:ID"));
  const issueDate = text(child(doc, "cbc:IssueDate"));
  if (!number || !issueDate) {
    throw new UblParseError("Dokumentu chýba číslo (cbc:ID) alebo dátum vystavenia (cbc:IssueDate) — nie je to platná UBL faktúra.");
  }

  const lineKey = documentType === "INVOICE" ? "cac:InvoiceLine" : "cac:CreditNoteLine";
  const quantityField = documentType === "INVOICE" ? "cbc:InvoicedQuantity" : "cbc:CreditedQuantity";
  const lineNodesRaw = child(doc, lineKey);
  const lineNodes = Array.isArray(lineNodesRaw) ? lineNodesRaw : lineNodesRaw !== undefined ? [lineNodesRaw] : [];

  const monetaryTotal = child(doc, "cac:LegalMonetaryTotal");
  // firstOf: a document can carry a second cac:TaxTotal for a tax currency alongside the
  // document currency (BG-13) — the first is always the document-currency one (the one whose
  // TaxAmount belongs with netAmountCents/grossAmountCents below).
  const taxTotal = firstOf(child(doc, "cac:TaxTotal"));

  return {
    documentType,
    number,
    issueDate,
    dueDate: text(child(doc, "cbc:DueDate")),
    currency: text(child(doc, "cbc:DocumentCurrencyCode")) ?? "EUR",
    buyerReference: text(child(doc, "cbc:BuyerReference")),
    supplier: parseParty(child(doc, "cac:AccountingSupplierParty")),
    customer: parseParty(child(doc, "cac:AccountingCustomerParty")),
    lines: parseLines(lineNodes, quantityField),
    netAmountCents: eurToCents(num(child(monetaryTotal, "cbc:LineExtensionAmount")) ?? 0),
    taxAmountCents: eurToCents(num(child(taxTotal, "cbc:TaxAmount")) ?? 0),
    // TaxInclusiveAmount (the full document total, BT-112) — not PayableAmount, which is
    // TaxInclusiveAmount minus any PrepaidAmount (BT-115) and so is *smaller* whenever a
    // prepayment is declared. grossAmountCents here must equal netAmountCents + taxAmountCents
    // for our own cross-checks (receivedInvoiceValidator.ts) to reconcile; PayableAmount elsewhere
    // means something different ("what's left to pay"), not "the document's total".
    grossAmountCents: eurToCents(num(child(monetaryTotal, "cbc:TaxInclusiveAmount")) ?? num(child(monetaryTotal, "cbc:PayableAmount")) ?? 0),
  };
}
