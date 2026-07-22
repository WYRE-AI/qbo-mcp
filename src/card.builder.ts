/**
 * Invoice-card payload builder for the MCP Apps (SEP-1865) UI surface.
 *
 * qbo_invoices_get results get a normalized `_card` object attached (see
 * src/entities/invoice.ts) that the ui:// invoice card renders from. The card
 * is progressive enhancement: every step here is best-effort, and a null
 * return simply means the host renders no card while the JSON payload is
 * unchanged. The card is read-only — no write round-trip.
 */

export const INVOICE_CARD_RESOURCE_URI = "ui://qbo/invoice-card.html";

/** Tool whose results carry the `_card` payload and advertise the UI. */
export const INVOICE_CARD_TOOL = "qbo_invoices_get";

/** MCP Apps resource MIME (RESOURCE_MIME_TYPE in @modelcontextprotocol/ext-apps). */
export const MCP_APP_RESOURCE_MIME = "text/html;profile=mcp-app";

/**
 * Tool `_meta` advertising the card. Carries both the canonical flat key
 * (RESOURCE_URI_META_KEY in ext-apps) and the nested form ext-apps'
 * registerAppTool emits, so any MCP Apps host revision finds it.
 */
export const INVOICE_CARD_META = {
  "ui/resourceUri": INVOICE_CARD_RESOURCE_URI,
  ui: { resourceUri: INVOICE_CARD_RESOURCE_URI },
} as const;

/** Mirror of Brand in ui/invoice-card.ts — keep in sync. */
export interface CardBrand {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  bg?: string;
  text?: string;
}

const BRAND_INJECT_MARKER = /<!--\s*BRAND_INJECT[\s\S]*?-->/;

/**
 * Operator branding from MCP_BRAND_* env vars. The card ships neutral (this
 * is a published server); self-hosters brand it without rebuilding by setting
 * these, and a gateway can inject window.__BRAND__ per-org the same way.
 */
export function resolveBrandFromEnv(
  env: Record<string, string | undefined> = typeof process !== "undefined"
    ? process.env
    : {},
): CardBrand {
  const brand: CardBrand = {};
  if (env.MCP_BRAND_NAME) brand.name = env.MCP_BRAND_NAME;
  if (env.MCP_BRAND_LOGO_URL) brand.logoUrl = env.MCP_BRAND_LOGO_URL;
  if (env.MCP_BRAND_PRIMARY_COLOR) brand.primaryColor = env.MCP_BRAND_PRIMARY_COLOR;
  if (env.MCP_BRAND_ACCENT_COLOR) brand.accentColor = env.MCP_BRAND_ACCENT_COLOR;
  if (env.MCP_BRAND_BG) brand.bg = env.MCP_BRAND_BG;
  if (env.MCP_BRAND_TEXT) brand.text = env.MCP_BRAND_TEXT;
  return brand;
}

/**
 * Replace the card's brand-injection marker with a window.__BRAND__ script.
 * An empty brand returns the HTML unchanged (neutral defaults). "<" is
 * escaped so brand values can never break out of the script element.
 */
export function applyBrandInjection(html: string, brand: CardBrand): string {
  const entries = Object.entries(brand).filter(([, v]) => v);
  if (entries.length === 0) return html;
  const json = JSON.stringify(Object.fromEntries(entries)).replace(/</g, "\\u003c");
  return html.replace(BRAND_INJECT_MARKER, `<script>window.__BRAND__=${json}</script>`);
}

/** Mirror of InvoiceCard in ui/invoice-card.ts — keep in sync. */
export interface InvoiceCard {
  id: string;
  docNumber?: string;
  /** Derived with the same semantics as the qbo_invoices_list status filter. */
  status: "Paid" | "Unpaid" | "Overdue";
  customer?: string;
  email?: string;
  txnDate?: string;
  dueDate?: string;
  total: number;
  balance: number;
  /** ISO currency code from CurrencyRef, e.g. "USD". */
  currency?: string;
  memo?: string;
  lines: Array<{ description: string; qty?: number; amount?: number }>;
}

const CARD_LINE_LIMIT = 8;
const CARD_TEXT_MAX_LENGTH = 300;

/** QBO reference object shape, e.g. {"value": "123", "name": "Acme Corp"}. */
interface QboRef {
  value?: unknown;
  name?: unknown;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Build the renderable card from a qbo_invoices_get response
 * (`{ Invoice: {...}, time }`). All labels come from fields QBO already
 * resolves server-side (CustomerRef.name, ItemRef.name) — no extra lookups.
 * Returns null when the payload doesn't look like an invoice.
 */
export function buildInvoiceCard(payload: unknown): InvoiceCard | null {
  const invoice = (payload as { Invoice?: Record<string, unknown> } | null)?.Invoice;
  if (!invoice || typeof invoice !== "object") return null;
  const id = str(invoice.Id);
  if (!id || typeof invoice.TotalAmt !== "number") return null;

  const balance = typeof invoice.Balance === "number" ? invoice.Balance : 0;
  const dueDate = str(invoice.DueDate);
  const today = new Date().toISOString().slice(0, 10);
  const status: InvoiceCard["status"] =
    balance <= 0 ? "Paid" : dueDate && dueDate < today ? "Overdue" : "Unpaid";

  const card: InvoiceCard = {
    id,
    status,
    total: invoice.TotalAmt,
    balance,
    lines: [],
  };

  const docNumber = str(invoice.DocNumber);
  if (docNumber) card.docNumber = docNumber;
  const customer = str((invoice.CustomerRef as QboRef | undefined)?.name);
  if (customer) card.customer = customer;
  const email = str((invoice.BillEmail as { Address?: unknown } | undefined)?.Address);
  if (email) card.email = email;
  const txnDate = str(invoice.TxnDate);
  if (txnDate) card.txnDate = txnDate;
  if (dueDate) card.dueDate = dueDate;
  const currency = str((invoice.CurrencyRef as QboRef | undefined)?.value);
  if (currency) card.currency = currency;
  const memo = str((invoice.CustomerMemo as { value?: unknown } | undefined)?.value);
  if (memo) card.memo = memo.slice(0, CARD_TEXT_MAX_LENGTH);

  const lines = Array.isArray(invoice.Line) ? invoice.Line : [];
  for (const raw of lines) {
    if (card.lines.length >= CARD_LINE_LIMIT) break;
    const line = raw as {
      DetailType?: unknown;
      Description?: unknown;
      Amount?: unknown;
      SalesItemLineDetail?: { ItemRef?: QboRef; Qty?: unknown };
    };
    if (line?.DetailType !== "SalesItemLineDetail") continue;
    const description =
      str(line.Description) ?? str(line.SalesItemLineDetail?.ItemRef?.name) ?? "Item";
    const entry: InvoiceCard["lines"][number] = {
      description: description.slice(0, CARD_TEXT_MAX_LENGTH),
    };
    const qty = line.SalesItemLineDetail?.Qty;
    if (typeof qty === "number") entry.qty = qty;
    if (typeof line.Amount === "number") entry.amount = line.Amount;
    card.lines.push(entry);
  }

  return card;
}

/**
 * Attach the `_card` payload to a qbo_invoices_get result. Best-effort by
 * construction: any failure (or a payload that isn't an invoice) returns the
 * result unchanged, so the model-visible JSON is never at risk.
 */
export function attachInvoiceCard(result: unknown): unknown {
  try {
    const card = buildInvoiceCard(result);
    if (card && result && typeof result === "object" && !Array.isArray(result)) {
      return { ...result, _card: card };
    }
  } catch {
    // Card building must never break the tool result.
  }
  return result;
}
