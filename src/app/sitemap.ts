import type { MetadataRoute } from "next";
import { POSTS } from "@/lib/blog";
import { CONNECTORS } from "@/lib/connectors";

const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

const staticPaths = [
  "/",
  "/pricing",
  "/docs",
  "/docs/quickstart",
  "/docs/api",
  "/docs/sdk",
  "/docs/cli",
  "/docs/mcp",
  "/docs/connectors",
  "/docs/concepts/identity",
  "/docs/concepts/vault",
  "/docs/concepts/policy",
  "/docs/concepts/grants",
  "/docs/concepts/approvals",
  "/docs/concepts/audit",
  "/docs/concepts/environments",
  "/about",
  "/blog",
  "/contact",
  "/security",
  "/status",
  "/legal/privacy",
  "/legal/terms",
  "/legal/dpa",
  "/sign-in",
  "/sign-up",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    ...staticPaths.map((path) => ({
      url: `${base}${path}`,
      lastModified: now,
      changeFrequency: path === "/" ? ("weekly" as const) : ("monthly" as const),
      priority: path === "/" ? 1 : path.startsWith("/docs") ? 0.8 : 0.6,
    })),
    ...CONNECTORS.map((connector) => ({
      url: `${base}/docs/connectors/${connector.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...POSTS.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: new Date(post.date),
      changeFrequency: "yearly" as const,
      priority: 0.5,
    })),
  ];
}
