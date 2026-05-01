import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@dxd/shared"],
  /* Monorepo: trace desde la raíz del workspace (`online/`) donde está `node_modules/next`. */
  experimental: {
    outputFileTracingRoot: path.join(__dirname, "../.."),
  },
  /* Copia dependencias trazadas a `.next/standalone`; en Vercel suele evitar MODULE_NOT_FOUND de `next/dist/compiled/*`. */
  output: "standalone",
};

export default nextConfig;
