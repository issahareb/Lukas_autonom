import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatContent } from "./chat-content";

describe("Chat content from model output", () => {
  it("renders readable lists, code and a scrollable table", () => {
    render(<ChatContent text={'## Nächste Schritte\n\n- **Planen**\n- Umsetzen\n\n```js\nconst x = 1;\n```\n\n| Aufgabe | Stand |\n| --- | --- |\n| Design | Fertig |'} />);
    expect(screen.getByRole("heading", { name: "Nächste Schritte" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("const x = 1;").tagName).toBe("CODE");
    expect(screen.getByLabelText("Tabelle horizontal scrollen").contains(screen.getByRole("table"))).toBe(true);
  });
  it("does not execute raw HTML, unsafe links, or load model-supplied remote images", () => {
    const { container } = render(<ChatContent text={'<script>alert(1)</script>\n\n[Link](javascript:alert)\n\n![Extern](https://example.com/tracker.png)'} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByRole("link", { name: "Extern" }).getAttribute("rel")).toBe("noreferrer");
  });
});
