import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import expressiveCode from "astro-expressive-code";
import pagefind from "astro-pagefind";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://g3ortega.github.io",
  base: "/codepiper",
  output: "static",

  integrations: [
    // Expressive Code MUST come before mdx()
    expressiveCode({
      themes: ["one-dark-pro", "github-light"],
      styleOverrides: {
        borderRadius: "0.75rem",
        codeFontFamily: '"DM Mono", "Menlo", "Monaco", monospace',
        codeFontSize: "0.875rem",
        codeLineHeight: "1.6",
      },
      defaultProps: {
        wrap: true,
      },
    }),
    mdx(),
    react(),
    sitemap(),
    pagefind(),
  ],

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": "/src",
      },
    },
  },

  markdown: {
    remarkPlugins: [],
    rehypePlugins: [],
  },

  image: {
    service: { entrypoint: "astro/assets/services/sharp" },
  },
});
