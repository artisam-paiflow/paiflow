// Keep install, build and deployed startup aligned with the app's engine floor.
// No dependencies: this must also run before pnpm has installed node_modules.
const range = require("../package.json").engines.node;
const bounds = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/.exec(range);
if (!bounds) throw new Error("Unsupported Node engine range; update the runtime check");

const minimum = bounds.slice(1, 4).map(Number);
const current = /^(\d+)\.(\d+)\.(\d+)$/.exec(process.versions.node)?.slice(1).map(Number);
const atLeastMinimum =
  current?.reduce(
    (comparison, value, index) => comparison || Math.sign(value - minimum[index]),
    0,
  ) >= 0;

if (!current || !atLeastMinimum || current[0] >= Number(bounds[4])) {
  process.stderr.write(`Node.js ${process.versions.node} is unsupported; required ${range}\n`);
  process.exitCode = 1;
} else if (require("node:zlib").constants.BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH !== -17) {
  // API/header sanity check only. The pinned package graph must separately
  // establish that the linked decoder implementation contains the security fix.
  process.stderr.write("Node.js runtime lacks the expected Brotli block-switch error marker\n");
  process.exitCode = 1;
} else {
  process.stdout.write(`Node.js runtime: ${process.version}; Brotli API marker: -17\n`);
}
