import { describe, expect, it } from "vitest";
import { app } from "@spectrum-ts/core";
import { interactiveCardSchema, parseCardSubmission, type InteractiveCard } from "../src/validation/interactive-cards.js";
import { photonCardHtml } from "../src/messaging/photon-card-html.js";

const card: InteractiveCard = {id: "99000000-0000-4000-8000-000000000001", title: "Choose products",
  fields: [{name: "selected", kind: "choice", label: "Items", multi: true, choices: [{value: "rice", label: "1. Rice"}, {value: "soup", label: "2. Soup"}]},
    {name: "qty_rice", kind: "number", label: "Max rice packages"}, {name: "qty_soup", kind: "number", label: "Max soup packages"}],
  actions: [{id: "products", label: "Use selected products"}]};

describe("interactive card inputs and rendering", () => {
  it("shows the full escaped form review and permits publication only on its review card", () => {
    const review = interactiveCardSchema.parse({...card, title: "Review order form", fields: [],
      actions: [{id: "publish_form", label: "Publish form"}, {id: "cancel", label: "Cancel"}]});
    expect(parseCardSubmission(review, new URLSearchParams("action=publish_form")))
      .toEqual({card_id: card.id, action: "publish_form"});
    expect(() => parseCardSubmission(card, new URLSearchParams("action=publish_form"))).toThrow("on this card");
    const html = photonCardHtml({sessionId: `photon-chat:${"a".repeat(64)}`, expires: 2000000000, status: "READY",
      reply: {text: "Dumplings — $11.50 per box; 50 packages\nPickup at <Fictional Hall>", card: review}}, "/cards/test", "csrf");
    expect(html).toContain("$11.50 per box; 50 packages");
    expect(html).toContain("&lt;Fictional Hall&gt;");
    expect(html).toContain('value="publish_form"');
  });
  it("captures multiple selections and separate whole package counts", () => {
    expect(parseCardSubmission(card, new URLSearchParams("action=products&selected=rice&selected=soup&qty_rice=50&qty_soup=30")))
      .toEqual({card_id: card.id, action: "products", selected: ["rice", "soup"], qty_rice: "50", qty_soup: "30"});
  });
  it.each([
    "action=products", "action=products&selected=foreign", "action=products&selected=rice&selected=rice",
    "action=accept&selected=rice", "action=products&selected=rice&qty_rice=2.5",
    "action=products&selected=rice&qty_rice=0", "action=products&selected=rice&qty_rice=10001",
    "action=products&selected=rice&qty_rice=3&qty_rice=4", "action=products&selected=rice&qty_rice=3&actor=other",
    "action=products&selected=rice&qty_rice=", "action=products&selected=rice&selected=soup&qty_rice=2"
  ])("rejects invalid or forged submission %s", query => {
    expect(() => parseCardSubmission(card, new URLSearchParams(query))).toThrow();
  });
  it("renders touch-sized checkboxes and escapes names, text, and URLs", () => {
    const reply = {text: "Products", card: {...card, title: "<script>Title</script>"}};
    const html = photonCardHtml({sessionId: `photon-chat:${"a".repeat(64)}`, expires: 2000000000, status: "READY", reply}, "/cards/test?x=1&y=2", "csrf");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('min-height:48px');
    expect(html).toContain('name="qty_rice"');
    expect(html).toContain("&lt;script&gt;Title&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("x=1&amp;y=2");
  });
  it("removes controls once processing or complete and never injects reply HTML", () => {
    for (const status of ["PROCESSING", "DONE", "FAILED"] as const) {
      const html = photonCardHtml({sessionId: `photon-chat:${"a".repeat(64)}`, expires: 2000000000, status,
        reply: {text: "Choose", card}, result: {text: "<img src=x>"}}, "/cards/test", "csrf");
      expect(html).not.toContain('<form');
      expect(html).not.toContain('<img src=x>');
    }
  });
  it("bounds card size and creates a native Spectrum app with an explicit layout", async () => {
    expect(interactiveCardSchema.safeParse({...card, actions: [{id: "arbitrary_sql", label: "Run"}]}).success).toBe(false);
    const built = await app("https://example.invalid/cards/test", {live: true, layout: {caption: card.title, subcaption: "Select products"}}).build();
    expect(built.type).toBe("app");
    if (built.type === "app") {
      expect(built.live).toBe(true);
      expect(await built.url()).toBe("https://example.invalid/cards/test");
      expect((await built.layout()).caption).toBe(card.title);
    }
  });
});
