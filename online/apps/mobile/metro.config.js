const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");
/** Solo `packages/`: evita que Metro indexe `apps/master-web/src/app` (Next) como si fuera Expo Router. */
const packagesRoot = path.join(monorepoRoot, "packages");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [packagesRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

config.resolver.disableHierarchicalLookup = true;

function resolveFromApp(pkg) {
  return path.dirname(
    require.resolve(`${pkg}/package.json`, { paths: [projectRoot, monorepoRoot] }),
  );
}

// Fuerza la misma copia de React / RN que usa esta app (workspace), evita desajuste con Expo Go.
config.resolver.extraNodeModules = {
  react: resolveFromApp("react"),
  "react-native": resolveFromApp("react-native"),
};

module.exports = config;
