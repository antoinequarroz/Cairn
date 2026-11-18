import { describe, expect, it } from "vitest";
import { matchSuiteLink, readReturnCookie, meetingMarkdown, meetingWhen, parseSuite, readMeeting, safeReturn } from "./suite";

const apps = parseSuite(undefined, "https://cairn.postmelo.ch");

describe("apps de la suite", () => {
  it("lists Alfred, Metricove and TickUp by default", () => {
    expect(apps.map((a) => a.name)).toEqual(["Alfred", "Metricove", "TickUp"]);
    expect(apps[0]).toMatchObject({ url: "https://alfred.postmelo.ch", role: "Calendrier" });
  });

  it("reads SUITE_APPS, leaves Cairn itself and broken entries out, and can be turned off", () => {
    const list = parseSuite("Alfred=https://cal.example.ch/x, Cairn=https://cairn.postmelo.ch,Bad=javascript:alert(1),=https://a.ch,Lamio=https://lamio.postmelo.ch", "https://cairn.postmelo.ch/");
    expect(list.map((a) => [a.name, a.url])).toEqual([
      ["Alfred", "https://cal.example.ch"],
      ["Lamio", "https://lamio.postmelo.ch"],
    ]);
    expect(parseSuite("off")).toEqual([]);
    expect(parseSuite("")).toEqual([]);
  });
});

describe("liens vers la suite", () => {
  it("recognises the app and what the page is", () => {
    expect(matchSuiteLink("https://alfred.postmelo.ch/events/12", apps)).toMatchObject({ app: { name: "Alfred" }, kind: "Événement" });
    expect(matchSuiteLink("https://metricove.postmelo.ch/posts/abc", apps)?.kind).toBe("Publication");
    expect(matchSuiteLink("https://tickup.postmelo.ch/p/CAIRN?issue=CAIRN-175", apps)?.kind).toBe("Ticket CAIRN-175");
    expect(matchSuiteLink("https://tickup.postmelo.ch/p/CAIRN", apps)?.kind).toBe("Projet");
  });

  it("ignores other sites, look-alikes and relative links", () => {
    expect(matchSuiteLink("https://alfred.postmelo.ch.evil.example/events/1", apps)).toBeNull();
    expect(matchSuiteLink("https://example.com", apps)).toBeNull();
    expect(matchSuiteLink("/notes/abc", apps)).toBeNull();
  });
});

describe("retour après la connexion", () => {
  it("only comes back to the meeting page", () => {
    expect(safeReturn("/notes/reunion?titre=Point&lien=https%3A%2F%2Falfred.postmelo.ch%2Fevents%2F1")).toBe("/notes/reunion?titre=Point&lien=https%3A%2F%2Falfred.postmelo.ch%2Fevents%2F1");
    expect(readReturnCookie(encodeURIComponent("/notes/reunion?titre=A%26B"))).toBe("/notes/reunion?titre=A%26B");
    expect(readReturnCookie("%E0%A4%A")).toBeNull();
    expect(safeReturn("/notes/reunion")).toBe("/notes/reunion");
    for (const bad of ["//evil.example/notes/reunion", "/notes/reunionx", "/notes/reunion/../../x", "https://evil.example/notes/reunion", "/notes/abc", "/notes/reunion\\x", "", undefined]) expect(safeReturn(bad)).toBeNull();
  });
});

describe("note de réunion", () => {
  it("formats the date in French", () => {
    expect(meetingWhen("2026-11-19T14:00:00Z", "2026-11-19T15:30:00Z", "Europe/Zurich")).toBe("jeudi 19 novembre 2026, 15:00 à 16:30");
    expect(meetingWhen("2026-11-19", null, "UTC")).toBe("jeudi 19 novembre 2026");
    expect(meetingWhen("demain matin", null)).toBe("demain matin");
    expect(meetingWhen(null, null)).toBe("");
  });

  it("keeps the link only when it leads to the suite, and escapes the title", () => {
    const m = readMeeting(new URLSearchParams({ titre: "Point [projet](https://evil.example)", date: "2026-11-19T14:00:00Z", lien: "https://alfred.postmelo.ch/events/12" }), apps, "Europe/Zurich");
    const md = meetingMarkdown(m);
    expect(md.split("\n")[0]).toBe("[Point \\[projet\\]\\(https://evil.example\\)](https://alfred.postmelo.ch/events/12)");
    expect(md).toContain("**Date** : jeudi 19 novembre 2026, 15:00");
    expect(md).toContain("## Actions");

    const other = readMeeting(new URLSearchParams({ lien: "https://evil.example/x" }), apps);
    expect(other.title).toBe("Réunion");
    expect(other.link).toBeNull();
    expect(meetingMarkdown(other)).not.toContain("evil");
  });
});
