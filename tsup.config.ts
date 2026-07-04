import { defineConfig } from 'tsup';

// Build dual ESM + CJS bundles with type declarations, so the package works for
// both `import` and `require` consumers. tsup (esbuild) handles the transpile;
// `tsc --noEmit` is used separately for type-checking.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
});
