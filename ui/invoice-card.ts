/**
 * Iframe bridge + renderer for the QuickBooks invoice card (MCP Apps,
 * SEP-1865).
 *
 * Runs inside the host's sandboxed iframe. Uses the official MCP Apps client
 * (`App`) to receive the tool result from the host. The card is read-only —
 * it renders the invoice and never calls back into the server.
 *
 * The server attaches a normalized `_card` payload to qbo_invoices_get
 * results (see src/card.builder.ts) so this renderer never needs to resolve
 * QBO reference objects itself.
 *
 * Rendering uses DOM construction (no innerHTML) — customer names, memos and
 * line descriptions are untrusted accounting data, so text only ever lands in
 * text nodes.
 *
 * Branding: the card is neutral by default (this is a published server) and
 * applies an injected `window.__BRAND__` override — set by the server from
 * MCP_BRAND_* env vars at serve time, or by a gateway per-org — so the same
 * card can render in any operator's brand.
 */
import { App } from "@modelcontextprotocol/ext-apps";

interface Brand {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  bg?: string;
  text?: string;
}
declare global {
  interface Window {
    __BRAND__?: Brand;
  }
}

/** Mirror of InvoiceCard in src/card.builder.ts — keep in sync. */
interface InvoiceCard {
  id: string;
  docNumber?: string;
  status: "Paid" | "Unpaid" | "Overdue";
  customer?: string;
  email?: string;
  txnDate?: string;
  dueDate?: string;
  total: number;
  balance: number;
  currency?: string;
  memo?: string;
  lines: Array<{ description: string; qty?: number; amount?: number }>;
}

const brand: Brand = window.__BRAND__ ?? {};
// No brand injected → no brand identity rendered (neutral default).
const brandName = brand.name ?? "";

// Apply any injected brand overrides onto the CSS custom properties.
function applyBrand(): void {
  const root = document.documentElement.style;
  if (brand.primaryColor) root.setProperty("--brand-primary", brand.primaryColor);
  if (brand.accentColor) root.setProperty("--brand-accent", brand.accentColor);
  if (brand.bg) root.setProperty("--brand-bg", brand.bg);
  if (brand.text) root.setProperty("--brand-text", brand.text);
}

const app = new App({ name: "QuickBooks Invoice Card", version: "1.0.0" });

/** Create an element with a class and (safe, text-node) children. */
function el(
  tag: string,
  className = "",
  ...children: Array<Node | string | null>
): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child == null) continue;
    node.append(child); // strings become text nodes — never parsed as HTML
  }
  return node;
}

function fmtMoney(amount: number, currency?: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function field(label: string, value: string | undefined): HTMLElement | null {
  if (!value) return null;
  return el(
    "div",
    "field",
    el("div", "field__label", label),
    el("div", "field__value", value),
  );
}

function lineEl(
  line: InvoiceCard["lines"][number],
  currency?: string,
): HTMLElement {
  return el(
    "div",
    "line",
    el("span", "line__desc", line.description),
    line.qty != null ? el("span", "line__qty", `× ${line.qty}`) : null,
    line.amount != null ? el("span", "line__amt", fmtMoney(line.amount, currency)) : null,
  );
}

function render(inv: InvoiceCard): void {
  // Empty when no brand is injected — the span still occupies the flex slot
  // so the invoice number stays right-aligned.
  const brandId = el("span", "brandid");
  if (brand.logoUrl) {
    const logo = document.createElement("img");
    logo.src = brand.logoUrl;
    logo.alt = brandName || "logo";
    logo.style.display = "inline-block";
    brandId.append(logo);
  }
  if (brandName) brandId.append(el("span", "brand", brandName));

  const docLabel = inv.docNumber ? `Invoice #${inv.docNumber}` : `Invoice ${inv.id}`;

  const linesSection = el(
    "div",
    "lines",
    el("div", "lines__h", `Line items (${inv.lines.length})`),
  );
  for (const line of inv.lines) linesSection.append(lineEl(line, inv.currency));
  linesSection.append(
    el(
      "div",
      "totalrow",
      el("span", "", "Total"),
      el("span", "", fmtMoney(inv.total, inv.currency)),
    ),
  );
  if (inv.balance > 0) {
    linesSection.append(
      el(
        "div",
        "totalrow totalrow--due",
        el("span", "", "Balance due"),
        el("span", "", fmtMoney(inv.balance, inv.currency)),
      ),
    );
  }
  if (inv.memo) linesSection.append(el("div", "memo", `“${inv.memo}”`));

  const body = el(
    "div",
    "card__body",
    el("div", "brandrow", brandId, el("span", "docno", `${docLabel} · QuickBooks`)),
    el("h1", "", inv.customer ?? docLabel),
    el(
      "div",
      "badges",
      el("span", "badge badge--status", inv.status),
      inv.balance > 0
        ? el("span", "badge badge--balance", `${fmtMoney(inv.balance, inv.currency)} due`)
        : null,
    ),
    el(
      "div",
      "grid",
      field("Invoice date", inv.txnDate && fmtDate(inv.txnDate)),
      field("Due date", inv.dueDate && fmtDate(inv.dueDate)),
      field("Bill to", inv.email),
      field("Currency", inv.currency),
    ),
    linesSection,
  );

  const root = document.getElementById("root")!;
  root.replaceChildren(el("div", "card", el("div", "card__bar"), body));
}

// qbo-mcp returns the QBO envelope { Invoice: {...}, time } and attaches the
// normalized card as a top-level _card field.
function extractCard(obj: unknown): InvoiceCard | null {
  const card = (obj as { _card?: InvoiceCard } | null)?._card;
  return card && typeof card.id === "string" && typeof card.total === "number"
    ? card
    : null;
}

applyBrand();

// Must be set before connect() so the initial tool-result isn't missed.
app.ontoolresult = (result: { content?: Array<{ type: string; text?: string }> }) => {
  const payload = (result.content ?? []).find((c) => c.type === "text");
  if (!payload?.text) return;
  try {
    const card = extractCard(JSON.parse(payload.text));
    if (card) render(card);
  } catch {
    /* ignore malformed payloads */
  }
};

app.connect();
