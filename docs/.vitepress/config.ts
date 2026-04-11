import { defineConfig } from "vitepress";

export default defineConfig({
  title: "vibe-racer",
  description: "Your AI race engineer — five laps from objective to shipped code",
  base: "/vibe-racer/",
  head: [["link", { rel: "icon", href: "/vibe-racer/logo-squared.png" }]],
  themeConfig: {
    logo: {
      light: "/logo-squared.png",
      dark: "/logo-squared-white.png",
    },
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Reference", link: "/commands" },
      {
        text: "GitHub",
        link: "https://github.com/teripaquitinho/vibe-racer",
      },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "What is vibe-racer?", link: "/" },
          { text: "Getting Started", link: "/getting-started" },
        ],
      },
      {
        text: "Guide",
        items: [
          { text: "The Five Laps", link: "/pipeline" },
          { text: "How It Works", link: "/how-it-works" },
          { text: "Security", link: "/security" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Commands", link: "/commands" },
          { text: "Configuration", link: "/configuration" },
          { text: "FAQ", link: "/faq" },
        ],
      },
    ],
    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/teripaquitinho/vibe-racer",
      },
    ],
    footer: {
      message: "Released under the MIT License.",
      copyright: "Built with Claude Code SDK by Anthropic",
    },
  },
});
