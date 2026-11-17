import { describe, expect, it } from "vitest";
import { codeLabel } from "./prose";

describe("codeLabel", () => {
  it("names shell code Terminal and keeps other languages", () => {
    expect(codeLabel("language-bash")).toBe("Terminal");
    expect(codeLabel("language-sh")).toBe("Terminal");
    expect(codeLabel("language-python")).toBe("python");
    expect(codeLabel("")).toBe("Code");
  });
});
