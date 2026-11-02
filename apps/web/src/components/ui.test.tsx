// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessibleDialog, Notice } from "./ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(element: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  return { host, root };
}

async function settle() {
  await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
}

function key(target: Element, keyName: string, shiftKey = false) {
  act(() => target.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true, shiftKey })));
}

afterEach(() => { document.body.innerHTML = ""; });

describe("AccessibleDialog", () => {
  it("focuses the first control, traps Tab and Shift+Tab, handles Escape, and restores the trigger", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.append(trigger);
    trigger.focus();
    let open = true;
    const onClose = vi.fn(() => { open = false; });
    const view = render(<AccessibleDialog open={open} onClose={onClose} titleId="dialog-title"><h2 id="dialog-title">Dialog</h2><button>First</button><button>Last</button></AccessibleDialog>);
    await settle();
    const buttons = Array.from(view.host.querySelectorAll("button"));
    expect(document.activeElement).toBe(buttons[0]);
    buttons[1].focus();
    key(buttons[1], "Tab");
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0].focus();
    key(buttons[0], "Tab", true);
    expect(document.activeElement).toBe(buttons[1]);
    key(buttons[1], "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(open).toBe(false);
    act(() => view.root.render(<AccessibleDialog open={false} onClose={onClose} titleId="dialog-title">Dialog</AccessibleDialog>));
    await settle();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Notice", () => {
  it("uses an assertive alert for errors and a polite status for success", () => {
    const view = render(<><Notice>Something failed</Notice><Notice tone="success">Saved</Notice></>);
    const notices = Array.from(view.host.querySelectorAll("[role]"));
    expect(notices[0]?.getAttribute("role")).toBe("alert");
    expect(notices[0]?.getAttribute("aria-live")).toBe("assertive");
    expect(notices[1]?.getAttribute("role")).toBe("status");
    expect(notices[1]?.getAttribute("aria-live")).toBe("polite");
  });
});
