import { describe, expect, it } from "vitest";
import { isNoteLink, isOwnFile, codeLabel } from "./markdown";

describe("Markdown : médias d'une réponse d'IA", () => {
  const origin = "https://cairn.exemple.ch";

  it("reconnaît les fichiers joints de l'app", () => {
    expect(isOwnFile("/api/files/abc123", origin)).toBe(true);
    expect(isOwnFile("https://cairn.exemple.ch/api/files/abc123", origin)).toBe(true);
  });

  it("refuse tout ce qui part vers un autre site, même écrit comme un chemin local", () => {
    for (const src of [
      "https://evil.example/p?d=secret",
      "//evil.example/api/files/x",
      "/\\evil.example/api/files/x",
      "\\\\evil.example/api/files/x",
      "/\t/evil.example/api/files/x",
      "https://cairn.exemple.ch.evil.example/api/files/x",
      "https://cairn.exemple.ch@evil.example/api/files/x",
      "http://cairn.exemple.ch/api/files/x",
      "data:image/png;base64,AAAA",
      "https://exa mple/",
    ])
      expect(isOwnFile(src, origin), src).toBe(false);
  });

  it("refuse les autres routes de l'app : une image ne doit appeler que des fichiers", () => {
    expect(isOwnFile("/api/notes?q=secret", origin)).toBe(false);
    expect(isOwnFile("/api/files/../notes", origin)).toBe(false);
    expect(isOwnFile("/logout", origin)).toBe(false);
  });
});

describe("codeLabel", () => {
  it("names shell code Terminal and keeps other languages", () => {
    expect(codeLabel("language-bash")).toBe("Terminal");
    expect(codeLabel("language-sh")).toBe("Terminal");
    expect(codeLabel("language-python")).toBe("python");
    expect(codeLabel("")).toBe("Code");
  });
});

describe("liens vers une note", () => {
  const origin = "https://cairn.exemple.ch";
  it("reconnaît un lien vers une note de l'app, et seulement ça", () => {
    expect(isNoteLink("/notes/abc_1-2", origin)).toBe(true);
    expect(isNoteLink("https://cairn.exemple.ch/notes/abc", origin)).toBe(true);
    expect(isNoteLink("//evil.example/notes/abc", origin)).toBe(false);
    expect(isNoteLink("/api/files/abc", origin)).toBe(false);
    expect(isNoteLink("/notes/abc/../../api/vault", origin)).toBe(false);
  });
});
