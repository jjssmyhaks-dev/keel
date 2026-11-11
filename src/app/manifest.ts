import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Authab — Identity, vault and governance for AI agents",
    short_name: "Authab",
    description:
      "Give every AI agent a short-lived cryptographic identity, a vault it can use but never read, and permissions a human approved.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f6",
    theme_color: "#0b0b0b",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-light-32x32.png", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
