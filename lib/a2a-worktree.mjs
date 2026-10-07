// Job worktree for a spawn-mode write task: one `git worktree add` next to the repo.
// This module NEVER removes anything — removal of a finished job worktree is a
// dispatcher task that needs a GO.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { validName } from "./a2a-registry.mjs";

const run = promisify(execFile);

export function jobWorktreePath(repo, taskId) {
  return join(resolve(repo), "..", `aos-wt-job-${validName(taskId)}`);
}

// `git worktree add <repo>/../aos-wt-job-<taskId> -b job/<taskId>` via execFile with an
// ARGUMENTS ARRAY — no shell, no interpolation into a command string.
export async function createJobWorktree(repo, taskId) {
  const id = validName(taskId);
  const path = jobWorktreePath(repo, id);
  await run("git", ["worktree", "add", path, "-b", `job/${id}`], { cwd: resolve(repo) });
  return path;
}
