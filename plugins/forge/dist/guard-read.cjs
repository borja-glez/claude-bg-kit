#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/forge/cli/guard-read.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_path = __toESM(require("node:path"), 1);

// src/forge/guard-fast.ts
var READ_TOOLS = ["Read", "Grep", "Glob"];
function isForgeAgent(agentType) {
  return typeof agentType === "string" && agentType.startsWith("forge");
}
function readPassesAtOnce(stdin2) {
  let input;
  try {
    input = JSON.parse(stdin2);
  } catch {
    return true;
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) return true;
  const { tool_name, agent_type } = input;
  return typeof tool_name === "string" && READ_TOOLS.includes(tool_name) && !isForgeAgent(agent_type);
}

// src/forge/cli/guard-read.ts
var stdin = "";
if (!process.stdin.isTTY) {
  try {
    stdin = (0, import_node_fs.readFileSync)(0, "utf8");
  } catch {
    stdin = "";
  }
}
if (!readPassesAtOnce(stdin)) {
  const forge = import_node_path.default.join(import_node_path.default.dirname(process.argv[1]), "forge.cjs");
  const r = (0, import_node_child_process.spawnSync)(process.execPath, [forge, "hook", "guard"], { input: stdin, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (!r.error) {
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    process.exitCode = r.status ?? 1;
  }
}
