// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { translateCallStatus } from "./DashboardPage";
import NotFoundPage from "./NotFoundPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key === "footer.attribution" ? "Design with ❤️ by @BOOMDEE" : key }),
}));

describe("dashboard localization and not-found footer", () => {
  it("maps known and unknown server statuses through translated labels", () => {
    const labels: Record<string, string> = {
      "recent.status.ended": "已结束",
      "recent.status.unknown": "未知",
    };
    const t = vi.fn((key: string) => labels[key] ?? key);

    expect(translateCallStatus(t, "ended")).toBe("已结束");
    expect(translateCallStatus(t, "unexpected-status")).toBe("未知");
  });

  it("renders the shared footer attribution on the not-found page", async () => {
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<MemoryRouter><NotFoundPage /></MemoryRouter>));
    expect(host.querySelector("footer")?.textContent).toContain("Design with ❤️ by @BOOMDEE");
    act(() => root.unmount());
  });
});
