import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@dxd/shared"],
  /* Monorepo npm: `next` suele estar hoisteado en `online/node_modules`, no dentro de `apps/master-web/node_modules`. */
  experimental: {
    outputFileTracingRoot: path.join(__dirname, "../.."),
    outputFileTracingIncludes: {
      "/*": ["../../node_modules/next/**/*"],
    },
  },
};

export default nextConfig;
