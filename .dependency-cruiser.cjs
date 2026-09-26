/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "pure-no-builtins",
      comment: "Pure code takes data as arguments. Move the I/O into a *.io.ts file of the same feature, or into src/cli/commands.io.ts.",
      severity: "error",
      from: { path: "^src/", pathNot: ["\\.io\\.ts$", "^src/cli/index\\.ts$"] },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "cli-via-index",
      comment: "The CLI imports a feature through src/lib/<feature>/index.ts. Export what it needs from that index.ts.",
      severity: "error",
      from: { path: "^src/cli/" },
      to: { path: "^src/lib/[^/]+/", pathNot: "/index\\.ts$" },
    },
    {
      name: "feature-via-index",
      comment: "Another feature is reached through its index.ts. Export what you need from src/lib/<feature>/index.ts; a feature's own files import each other directly.",
      severity: "error",
      from: { path: "^src/lib/([^/]+)/" },
      to: { path: "^src/lib/[^/]+/", pathNot: ["^src/lib/$1/", "/index\\.ts$"] },
    },
    {
      name: "outside-via-index",
      comment: "Tests and scripts use a feature through its index.ts like any caller, so moving a file inside a feature never touches a test.",
      severity: "error",
      from: { path: "^(tests|scripts)/" },
      to: { path: "^src/lib/[^/]+/", pathNot: "/index\\.ts$" },
    },
    {
      name: "lib-not-cli",
      comment: "The library never depends on the CLI. Move the shared piece into src/lib.",
      severity: "error",
      from: { path: "^src/lib/" },
      to: { path: "^src/cli/" },
    },
    {
      name: "no-circular",
      comment: "Break the cycle by moving the shared piece down, usually into src/lib/types.ts.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      comment: "An unused module is deleted, not kept.",
      severity: "error",
      from: { orphan: true, path: "^src/", pathNot: "^src/cli/index\\.ts$" },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    parser: "swc",
  },
};
