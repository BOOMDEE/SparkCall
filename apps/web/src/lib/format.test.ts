import { describe, expect, it } from "vitest";
import { formatBytes, formatDate, formatDuration, formatElapsed } from "./format";

describe("formatBytes", () => {
  it("uses decimal units for Cloudflare byte totals", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1_250_000)).toBe("1.25 MB");
  });
  it("marks unavailable or invalid values explicitly", () => {
    expect(formatBytes(null)).toBe("Unavailable");
    expect(formatBytes(Number.NaN)).toBe("Unavailable");
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours with stable padding", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3_661)).toBe("1:01:01");
  });
  it("handles negative and absent durations", () => {
    expect(formatDuration(-2)).toBe("0:00");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatElapsed(90_000)).toBe("1:30");
  });
});

describe("formatDate", () => {
  it("returns a fallback for missing or invalid values", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });
});
