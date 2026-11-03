import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [{
    name: "sparkcall-configuration-yaml-text",
    enforce: "pre",
    transform(_source, id) {
      const file = id.split("?")[0];
      if (!file?.endsWith("/configuration.yaml")) return null;
      return { code: `export default ${JSON.stringify(readFileSync(file, "utf8"))};`, map: null };
    },
  }],
});
