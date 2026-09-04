import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
export default {
  input: "src/plugin.js",
  output: { file: "com.4xsdev.claude.sdPlugin/bin/plugin.js", format: "es", sourcemap: false },
  plugins: [nodeResolve({ preferBuiltins: true }), commonjs()],
  external: [/^node:/],
};
