import { describe, it, expect } from "vitest";
import {
  assertDate,
  assertPositiveInt,
  buildDatedListSql,
  buildLikeSearchSql,
  escapeQboSearchTerm,
  escapeQboString,
  QBO_MAX_START_POSITION,
} from "../utils/qbo-sql.js";
import { parseEnvironment } from "../utils/client.js";

describe("escapeQboString", () => {
  it("doubles single quotes per SQL string-literal escaping", () => {
    expect(escapeQboString("O'Brien")).toBe("O''Brien");
    expect(escapeQboString("'; DROP TABLE Customer; --")).toBe(
      "''; DROP TABLE Customer; --"
    );
  });

  it("leaves clean strings untouched", () => {
    expect(escapeQboString("Acme Corp")).toBe("Acme Corp");
    expect(escapeQboString("")).toBe("");
  });

  it("prevents the customers-search injection vector", () => {
    // Caller intent: LIKE '%term%'. Without escaping, this term breaks out
    // of the quoted literal and appends a tautology.
    const malicious = "x%' OR '1'='1";
    const safe = escapeQboString(malicious);
    const sql = `WHERE DisplayName LIKE '%${safe}%'`;
    // The closing quote of OR '1'='1 is now doubled and stays inside the literal.
    expect(sql).toBe("WHERE DisplayName LIKE '%x%'' OR ''1''=''1%'");
  });
});

describe("escapeQboSearchTerm", () => {
  it("doubles quotes and backslashes but leaves % and _ as QBO LIKE sees them", () => {
    expect(escapeQboSearchTerm("50%")).toBe("50%");
    expect(escapeQboSearchTerm("foo_bar")).toBe("foo_bar");
    expect(escapeQboSearchTerm("plain")).toBe("plain");
    expect(escapeQboSearchTerm("O'Brien")).toBe("O''Brien");
    expect(escapeQboSearchTerm("a\\b")).toBe("a\\\\b");
    expect(escapeQboSearchTerm("trailing\\")).toBe("trailing\\\\");
  });
});

describe("buildLikeSearchSql", () => {
  it("does not emit ESCAPE, which QBO's parser rejects", () => {
    const sql = buildLikeSearchSql("Customer", "DisplayName", "Scharpf");
    expect(sql).toBe(
      "SELECT * FROM Customer WHERE DisplayName LIKE '%Scharpf%' STARTPOSITION 1 MAXRESULTS 100"
    );
    expect(sql).not.toContain("ESCAPE");
  });

  it("quote-escapes the term and pages past 1000", () => {
    const sql = buildLikeSearchSql("Customer", "DisplayName", "O'Brien", {
      startPosition: 1001,
      maxResults: 25,
    });
    expect(sql).toBe(
      "SELECT * FROM Customer WHERE DisplayName LIKE '%O''Brien%' STARTPOSITION 1001 MAXRESULTS 25"
    );
  });

  it("keeps a breakout attempt inside the LIKE literal", () => {
    const sql = buildLikeSearchSql("Customer", "DisplayName", "x%' OR '1'='1");
    expect(sql).toBe(
      "SELECT * FROM Customer WHERE DisplayName LIKE '%x%'' OR ''1''=''1%' STARTPOSITION 1 MAXRESULTS 100"
    );
  });
});

describe("assertDate", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(assertDate("2026-05-13", "startDate")).toBe("2026-05-13");
  });

  it("rejects shapes that could break out of the quote", () => {
    expect(() => assertDate("2026-05-13' OR '1", "startDate")).toThrow(
      /Invalid startDate/
    );
    expect(() => assertDate("2026/05/13", "startDate")).toThrow();
    expect(() => assertDate("", "startDate")).toThrow();
  });
});

describe("assertPositiveInt", () => {
  it("accepts integers in range", () => {
    expect(assertPositiveInt(1, "x")).toBe(1);
    expect(assertPositiveInt(1000, "x")).toBe(1000);
    expect(assertPositiveInt("50", "x")).toBe(50);
  });

  it("rejects out-of-range or non-integer", () => {
    expect(() => assertPositiveInt(0, "x")).toThrow();
    expect(() => assertPositiveInt(1001, "x")).toThrow();
    expect(() => assertPositiveInt(1.5, "x")).toThrow();
    expect(() => assertPositiveInt("abc", "x")).toThrow();
  });

  it("accepts a STARTPOSITION past the MAXRESULTS cap when asked", () => {
    expect(
      assertPositiveInt(1001, "startPosition", { max: QBO_MAX_START_POSITION })
    ).toBe(1001);
    expect(() =>
      assertPositiveInt(QBO_MAX_START_POSITION + 1, "startPosition", {
        max: QBO_MAX_START_POSITION,
      })
    ).toThrow(/startPosition/);
  });
});

describe("buildDatedListSql", () => {
  it("emits a bare list query when no filters are given", () => {
    expect(buildDatedListSql("Payment", {})).toBe(
      "SELECT * FROM Payment STARTPOSITION 1 MAXRESULTS 100"
    );
  });

  it("adds TxnDate conditions and validates dates", () => {
    expect(
      buildDatedListSql("Bill", { startDate: "2026-01-01", endDate: "2026-12-31" })
    ).toBe(
      "SELECT * FROM Bill WHERE TxnDate >= '2026-01-01' AND TxnDate <= '2026-12-31' STARTPOSITION 1 MAXRESULTS 100"
    );
    expect(() => buildDatedListSql("Bill", { startDate: "nope" })).toThrow(
      /Invalid startDate/
    );
  });

  it("allows startPosition past 1000 and still caps maxResults", () => {
    expect(buildDatedListSql("Payment", { startPosition: 1001, maxResults: 1000 })).toBe(
      "SELECT * FROM Payment STARTPOSITION 1001 MAXRESULTS 1000"
    );
    expect(() => buildDatedListSql("Payment", { maxResults: 1001 })).toThrow(/maxResults/);
    expect(() => buildDatedListSql("Payment", { startPosition: 0 })).toThrow(/startPosition/);
  });

  it("prepends caller-supplied conditions before the date range", () => {
    const sql = buildDatedListSql(
      "Invoice",
      { startDate: "2026-01-01" },
      ["Balance > '0'"]
    );
    expect(sql).toBe(
      "SELECT * FROM Invoice WHERE Balance > '0' AND TxnDate >= '2026-01-01' STARTPOSITION 1 MAXRESULTS 100"
    );
  });
});

describe("parseEnvironment", () => {
  it("defaults to production when empty/undefined", () => {
    expect(parseEnvironment(undefined)).toBe("production");
    expect(parseEnvironment("")).toBe("production");
  });

  it("recognizes prod/production and sbx/sandbox case-insensitively", () => {
    expect(parseEnvironment("sandbox")).toBe("sandbox");
    expect(parseEnvironment("SBX")).toBe("sandbox");
    expect(parseEnvironment("Production")).toBe("production");
    expect(parseEnvironment("prod")).toBe("production");
  });

  it("throws on unrecognized non-empty values rather than silently defaulting", () => {
    expect(() => parseEnvironment("staging")).toThrow(/Invalid QBO environment/);
    expect(() => parseEnvironment("dev")).toThrow();
  });
});
