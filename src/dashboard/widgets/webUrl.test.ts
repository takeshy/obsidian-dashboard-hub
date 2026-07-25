import { describe, expect, it } from "vitest";
import { safeWebUrl } from "./webUrl";

describe("safeWebUrl", () => {
  it.each(["https://example.com", "http://localhost:3000/path"])("allows %s", (url) => {
    expect(safeWebUrl(url)).toBe(url === "https://example.com" ? `${url}/` : url);
  });

  it.each([
    "javascript:alert(document.domain)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "obsidian://open?vault=test",
    "//example.com",
    "not a URL",
  ])("rejects %s", (url) => {
    expect(safeWebUrl(url)).toBeNull();
  });
});
