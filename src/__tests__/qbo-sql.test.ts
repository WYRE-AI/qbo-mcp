import { describe, it, expect } from "vitest";
import {
  assertDate,
  assertPositiveInt,
  escapeQboString,
} from "../utils/qbo-sql.js";

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
});
