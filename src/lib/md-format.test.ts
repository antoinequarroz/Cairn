import { describe, expect, it } from "vitest";
import { activeFormats, blockOf, codeBlock, continueList, indentList, insertBlock, link, setBlock, toggleInline, type Edit } from "./md-format";

/** Applies an edit and shows the selection with [ ] (or | for a caret), to read the expectations at a glance. */
function show(text: string, e: Edit | null) {
  if (!e) return null;
  const t = text.slice(0, e.from) + e.insert + text.slice(e.to);
  if (e.selStart === e.selEnd) return t.slice(0, e.selStart) + "|" + t.slice(e.selStart);
  return t.slice(0, e.selStart) + "[" + t.slice(e.selStart, e.selEnd) + "]" + t.slice(e.selEnd);
}

/** "a [b] c" or "a|b" → text and selection. */
function sel(s: string): [string, number, number] {
  const c = s.indexOf("|");
  if (c !== -1) return [s.replace("|", ""), c, c];
  const a = s.indexOf("[");
  const b = s.indexOf("]") - 1;
  return [s.replace("[", "").replace("]", ""), a, b];
}

const run = (fn: (t: string, a: number, b: number) => Edit | null, s: string) => {
  const [t, a, b] = sel(s);
  return show(t, fn(t, a, b));
};

describe("toggleInline", () => {
  it("wraps the selection and keeps it selected", () => {
    expect(run((t, a, b) => toggleInline(t, a, b, "bold"), "un [mot] ici")).toBe("un **[mot]** ici");
    expect(run((t, a, b) => toggleInline(t, a, b, "italic"), "un [mot] ici")).toBe("un *[mot]* ici");
    expect(run((t, a, b) => toggleInline(t, a, b, "strike"), "[mot]")).toBe("~~[mot]~~");
    expect(run((t, a, b) => toggleInline(t, a, b, "code"), "[mot]")).toBe("`[mot]`");
  });
  it("leaves surrounding spaces outside the marks", () => {
    expect(run((t, a, b) => toggleInline(t, a, b, "bold"), "un[ mot ]ici")).toBe("un **[mot]** ici");
  });
  it("removes the marks when they are already there", () => {
    expect(run((t, a, b) => toggleInline(t, a, b, "bold"), "un **[mot]** ici")).toBe("un [mot] ici");
    expect(run((t, a, b) => toggleInline(t, a, b, "bold"), "un [**mot**] ici")).toBe("un [mot] ici");
    expect(run((t, a, b) => toggleInline(t, a, b, "italic"), "*[mot]*")).toBe("[mot]");
  });
  it("tells bold and italic apart", () => {
    expect(run((t, a, b) => toggleInline(t, a, b, "italic"), "**[mot]**")).toBe("***[mot]***");
    expect(run((t, a, b) => toggleInline(t, a, b, "bold"), "*[mot]*")).toBe("***[mot]***");
    expect(run((t, a, b) => toggleInline(t, a, b, "italic"), "***[mot]***")).toBe("**[mot]**");
    expect(run((t, a, b) => toggleInline(t, a, b, "bold"), "***[mot]***")).toBe("*[mot]*");
  });
  it("inserts a selected placeholder with nothing selected", () => {
    expect(run((t, a, b) => toggleInline(t, a, b, "bold"), "a |b")).toBe("a **[texte en gras]**b");
  });
  it("formats each line of a multi-line selection", () => {
    expect(run((t, a, b) => toggleInline(t, a, b, "bold"), "[un\n\ndeux]")).toBe("[**un**\n\n**deux**]");
  });
});

describe("setBlock", () => {
  it("turns a line into a heading and keeps the caret in the words", () => {
    expect(run((t, a, b) => setBlock(t, a, b, "h2"), "Mon ti|tre")).toBe("## Mon ti|tre");
    expect(run((t, a, b) => setBlock(t, a, b, "h1"), "## Mon ti|tre")).toBe("# Mon ti|tre");
    expect(run((t, a, b) => setBlock(t, a, b, "h1"), "# Mon ti|tre")).toBe("Mon ti|tre");
  });
  it("starts a list on an empty line", () => {
    expect(run((t, a, b) => setBlock(t, a, b, "bullet"), "a\n|")).toBe("a\n- |");
    expect(run((t, a, b) => setBlock(t, a, b, "task"), "|")).toBe("- [ ] |");
  });
  it("numbers the lines and swaps one list for another", () => {
    expect(run((t, a, b) => setBlock(t, a, b, "numbered"), "[un\ndeux\ntrois]")).toBe("[1. un\n2. deux\n3. trois]");
    expect(run((t, a, b) => setBlock(t, a, b, "task"), "[- un\n- deux]")).toBe("[- [ ] un\n- [ ] deux]");
  });
  it("removes the list when every line already is one", () => {
    expect(run((t, a, b) => setBlock(t, a, b, "bullet"), "[- un\n- deux]")).toBe("[un\ndeux]");
  });
  it("leaves empty lines alone and keeps list indentation", () => {
    expect(run((t, a, b) => setBlock(t, a, b, "quote"), "[un\n\ndeux]")).toBe("[> un\n\n> deux]");
    expect(run((t, a, b) => setBlock(t, a, b, "numbered"), "  - so|us")).toBe("  1. so|us");
  });
});

describe("blocks", () => {
  it("knows what a line is", () => {
    expect(blockOf("### x")).toBe("h3");
    expect(blockOf("- [x] fait")).toBe("task");
    expect(blockOf("12) x")).toBe("numbered");
    expect(blockOf("#hashtag")).toBe("paragraph");
  });
  it("puts a block on its own lines", () => {
    expect(run((t, a, b) => insertBlock(t, a, b, "---"), "avant|après")).toBe("avant\n\n---|\n\naprès");
    expect(run((t, a, b) => insertBlock(t, a, b, "---"), "avant\n\n|")).toBe("avant\n\n---|\n");
  });
  it("makes a code block", () => {
    expect(run(codeBlock, "|")).toBe("```\n|\n```\n");
    expect(run(codeBlock, "[let a = 1]")).toBe("```\n[let a = 1]\n```\n");
  });
});

describe("link", () => {
  it("selects the address to paste over", () => {
    expect(run(link, "voir [la doc]")).toBe("voir [la doc]([https://])");
  });
  it("uses a selected address as the address", () => {
    expect(run(link, "[https://cairn.app]")).toBe("[[texte du lien]](https://cairn.app)");
  });
});

describe("lists while typing", () => {
  it("continues the list on Enter", () => {
    expect(run(continueList, "- un|")).toBe("- un\n- |");
    expect(run(continueList, "3. trois|")).toBe("3. trois\n4. |");
    expect(run(continueList, "- [x] fait|")).toBe("- [x] fait\n- [ ] |");
    expect(run(continueList, "  - sous|")).toBe("  - sous\n  - |");
  });
  it("ends the list on an empty item", () => {
    expect(run(continueList, "- un\n- |")).toBe("- un\n\n|");
    expect(run(continueList, "- un\n  - |")).toBe("- un\n- |");
  });
  it("does nothing outside a list", () => {
    expect(run(continueList, "texte|")).toBeNull();
    expect(run(continueList, "-|")).toBeNull();
  });
  it("indents and outdents list lines only", () => {
    expect(run((t, a, b) => indentList(t, a, b, false), "- un|")).toBe("  - un|");
    expect(run((t, a, b) => indentList(t, a, b, true), "  - un|")).toBe("- un|");
    expect(run((t, a, b) => indentList(t, a, b, false), "texte|")).toBeNull();
  });
});

describe("activeFormats", () => {
  it("lights up what the caret is in", () => {
    const at = (s: string) => {
      const [t, a, b] = sel(s);
      const f = activeFormats(t, a, b);
      return [f.block, [...f.inline].sort().join(",")];
    };
    expect(at("## un **gr|as**")).toEqual(["h2", "bold"]);
    expect(at("- un *ita|l* x")).toEqual(["bullet", "italic"]);
    expect(at("***to|us***")).toEqual(["paragraph", "bold,italic"]);
    expect(at("`a**|b**`")).toEqual(["paragraph", "code"]);
  });
});
