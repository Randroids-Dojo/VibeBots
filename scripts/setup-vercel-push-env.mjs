#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import webpush from "web-push";

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function runVercel(args, input = null) {
  return spawnSync("vercel", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    input,
    stdio: ["pipe", "ignore", "ignore"],
  });
}

function ensureVercel() {
  const result = spawnSync("vercel", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
  });
  if (result.status !== 0) {
    throw new Error("Vercel CLI is not available on PATH.");
  }
}

function removeEnv(name, targetArgs) {
  runVercel(["env", "rm", name, ...targetArgs, "--yes"]);
}

function addEnv(name, value, targetArgs, { sensitive }) {
  const args = [
    "env",
    "add",
    name,
    ...targetArgs,
    "--yes",
    "--force",
    "--value",
    value,
  ];
  if (sensitive) args.push("--sensitive");
  const result = runVercel(args);
  if (result.status !== 0) {
    throw new Error(`Failed to set ${name} for ${targetArgs.join(" ")}.`);
  }
}

function setTarget(env, targetArgs) {
  for (const name of ["VAPID_PRIVATE_KEY", "NOTIFICATION_ADMIN_TOKEN"]) {
    removeEnv(name, targetArgs);
  }

  for (const [name, value] of Object.entries(env)) {
    addEnv(name, value, targetArgs, {
      sensitive:
        name === "VAPID_PRIVATE_KEY" || name === "NOTIFICATION_ADMIN_TOKEN",
    });
    console.log(`set ${name} for ${targetArgs.join(" ")}`);
  }
}

function main() {
  ensureVercel();

  const contactEmail = argValue("--contact-email") ?? "support@randroid.dev";
  const previewBranch = argValue("--preview-branch");
  const productionOnly = hasArg("--production-only");
  const keys = webpush.generateVAPIDKeys();
  const env = {
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    WEB_PUSH_CONTACT_EMAIL: contactEmail,
    NOTIFICATION_ADMIN_TOKEN: crypto.randomBytes(32).toString("base64url"),
  };

  setTarget(env, ["production"]);

  if (previewBranch && !productionOnly) {
    try {
      setTarget(env, ["preview", previewBranch]);
    } catch (error) {
      console.warn(
        `preview setup skipped: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  console.log("generated and stored fresh notification secrets");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "setup failed");
  process.exit(1);
}
