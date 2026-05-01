import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@dxd/shared"],
  /* Obligatorio en monorepo npm: `next` vive en `online/node_modules`; sin esto Vercel no empaqueta
     `next/dist/compiled/...` y falla en runtime (Cannot find module ... server.runtime.prod.js). */
  experimental: {
    outputFileTracingRoot: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
