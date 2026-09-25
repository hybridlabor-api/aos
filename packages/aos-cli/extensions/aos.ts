/**
 * AOS CLI commands -- `/aos` and `/aos-status`.
 *
 * Read-only by default. The AOS installer owns the terminal: it animates, it
 * prompts, and pi's own docs say an extension must not create a second
 * terminal renderer. So anything that needs a real TTY (install, update,
 * uninstall) is reported as a command to run outside the session rather than
 * spawned here -- a nested installer inside pi's TUI corrupts both.
 *
 * `aos-doctor --json` is the only thing this executes, and it is read-only.
 * The shape it returns is stable and is asserted by tests/aos-doctor.test.mjs:
 *   { ok, platform, arch, results: [{ area, name, ok, detail, warningOnly }] }
 */

import { spawn } from "node:child_process";
import { connect } from "node:net";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
// DynamicBorder is re-exported by the agent package, not by pi-tui -- the
// examples/extensions/preset.ts reference splits them the same way.
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, SelectItem, SelectList, Text } from "@earendil-works/pi-tui";

const DASHBOARD_PORT = 7900;
const DOCTOR_TIMEOUT_MS = 20_000;
const AUTH_TIMEOUT_MS = 8_000;

/**
 * Providers to check for credentials, in priority order.
 *
 * A second provider slots in here and nowhere else -- the check, the status
 * row and the startup notice all read this list. pi owns provider auth, not the
 * AOS installer: it already has a `/login` command, and the AOS installer has no
 * business asking for an Anthropic key it will never use itself. AOS CLI only
 * has to notice when nothing is configured and point at `/login`.
 *
 * Deliberately short. Reporting "no configured provider (checked: ...)" with an
 * honest list beats claiming a global state this process cannot actually see.
 */
const PROVIDERS = ["anthropic", "google"] as const;

interface DoctorResult {
	area: string;
	name: string;
	ok: boolean;
	detail: string;
	warningOnly: boolean;
}
interface DoctorReport {
	ok: boolean;
	results: DoctorResult[];
}

/**
 * Run aos-doctor and return its report whatever the exit code.
 *
 * aos-doctor exits 1 whenever any single check is not ok -- that is the normal
 * "something needs attention" answer, not a failure to run. Rejecting on a
 * non-zero exit threw away a valid 27-check report and rendered as
 * "aos-doctor could not be run", which is the worst possible reading: it
 * reports the absence of a check as if the check had passed. The report's own
 * `ok` field is the verdict; the exit code carries no extra information.
 */
function runDoctor(): Promise<DoctorReport> {
	return new Promise((resolve, reject) => {
		// shell on Windows only: the global shims are .cmd there, and spawn
		// does not resolve those without it.
		const child = spawn("aos-doctor", ["--json"], {
			timeout: DOCTOR_TIMEOUT_MS,
			shell: process.platform === "win32",
		});
		let out = "";
		let err = "";
		child.stdout?.on("data", (c) => {
			out += c;
		});
		child.stderr?.on("data", (c) => {
			err += c;
		});
		child.once("error", reject);
		child.once("close", (code) => {
			try {
				resolve(JSON.parse(out) as DoctorReport);
			} catch {
				reject(new Error(err.trim() || `aos-doctor produced no JSON (exit ${code})`));
			}
		});
	});
}

/**
 * Ask pi whether one provider has usable credentials.
 *
 * `pi auth check --provider <name> --json` is a documented CLI surface and
 * exits 0 for every verdict, including not_ready, so the JSON is the answer and
 * the exit code carries nothing. `pi --list-models` was the tempting shortcut
 * and is wrong: it lists every provider pi knows about whether or not a key is
 * present, so a model in the list says nothing about being able to use it.
 *
 * A provider this check cannot reach at all is "unknown", never "not ready" --
 * those are different states and reporting one as the other is how a health
 * check ends up lying.
 */
function checkProvider(provider: string): Promise<"ready" | "not_ready" | "unknown"> {
	return new Promise((resolve) => {
		// argv[1] is pi's own bundle, because pi is the process running this
		// extension. PATH is the fallback for a launch that re-execs a bare `pi`.
		const entry = process.argv[1];
		const [command, prefix] =
			entry && /pi/i.test(entry) ? [process.execPath, [entry]] : ["pi", []];

		const child = spawn(command, [...prefix, "auth", "check", "--provider", provider, "--json"], {
			timeout: AUTH_TIMEOUT_MS,
			shell: process.platform === "win32",
		});
		let out = "";
		child.stdout?.on("data", (c) => {
			out += c;
		});
		child.once("error", () => resolve("unknown"));
		child.once("close", () => {
			try {
				const parsed = JSON.parse(out) as { status?: string };
				resolve(parsed.status === "ready" ? "ready" : "not_ready");
			} catch {
				resolve("unknown");
			}
		});
	});
}

/** One row per provider, ready ones first, for the status overlay. */
async function providerStatus(): Promise<{ provider: string; state: string }[]> {
	return Promise.all(
		PROVIDERS.map(async (provider) => ({ provider, state: await checkProvider(provider) })),
	);
}

function portOpen(port: number, timeoutMs = 500): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect({ port, host: "127.0.0.1" });
		const done = (up: boolean) => {
			socket.destroy();
			resolve(up);
		};
		socket.setTimeout(timeoutMs);
		socket.once("connect", () => done(true));
		socket.once("timeout", () => done(false));
		socket.once("error", () => done(false));
	});
}

async function showStatus(ctx: ExtensionContext): Promise<void> {
	let report: DoctorReport | null = null;
	let failure: string | null = null;
	try {
		report = await runDoctor();
	} catch (err) {
		failure = err instanceof Error ? err.message : String(err);
	}
	const dashboardUp = await portOpen(DASHBOARD_PORT);
	const providers = await providerStatus();
	const anyReady = providers.some((p) => p.state === "ready");

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));

		const mark = (ok: boolean) => theme.fg(ok ? "success" : "error", ok ? "●" : "○");

		if (failure) {
			container.addChild(new Text(theme.fg("error", "aos-doctor could not be run")));
			container.addChild(new Text(theme.fg("muted", failure)));
			container.addChild(new Text(theme.fg("dim", "It is installed by `npx @hybridlabor-api/aos`.")));
		} else if (report) {
			const failing = report.results.filter((r) => !r.ok);
			container.addChild(
				new Text(
					theme.bold(
						`AOS ${failing.length === 0 ? theme.fg("success", "healthy") : theme.fg("error", `${failing.length} failing check(s)`)}`,
					),
				),
			);
			container.addChild(new Text(""));
			for (const r of report.results) {
				container.addChild(new Text(`${mark(r.ok)} ${r.name}${r.ok ? "" : theme.fg("error", "  ← needs attention")}`));
				if (r.detail) container.addChild(new Text(theme.fg("muted", `    ${r.detail}`)));
			}
		}

		container.addChild(new Text(""));
		container.addChild(
			new Text(
				`${mark(dashboardUp)} Dashboard :${DASHBOARD_PORT} ${
					dashboardUp ? theme.fg("success", "running") : theme.fg("dim", "stopped -- run `npx aos-dashboard`")
				}`,
			),
		);
		container.addChild(
			new Text(
				`${mark(anyReady)} Model ${
					anyReady
						? theme.fg("success", providers.filter((p) => p.state === "ready").map((p) => p.provider).join(", "))
						: theme.fg("error", "no provider configured -- run /login in pi")
				}`,
			),
		);
		container.addChild(new Text(""));
		container.addChild(new Text(theme.fg("dim", "esc or enter to close")));
		container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));

		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				if (data === "" || data === "\r" || data === "\n" || data === "") done();
				tui.requestRender();
			},
		};
	});
}

export default function aosCommands(pi: ExtensionAPI) {
	// Fire and forget on session_start: never block startup on it, and never
	// repeat the notice. A user without credentials can still read skills, run
	// /aos-status and browse -- only sending a message needs a model, so this is
	// a notice, not a gate.
	let warnedNoProvider = false;
	pi.on("session_start", async (_event, ctx) => {
		if (warnedNoProvider) return;
		const providers = await providerStatus();
		if (providers.some((p) => p.state === "ready")) return;
		warnedNoProvider = true;
		const unknown = providers.filter((p) => p.state === "unknown").map((p) => p.provider);
		ctx.ui.notify(
			`No model provider configured (checked: ${providers.map((p) => p.provider).join(", ")}). ` +
				`Run /login in pi before sending a message.`,
			"warning",
		);
		if (unknown.length) {
			ctx.ui.notify(`Could not reach pi's auth check for: ${unknown.join(", ")} -- treated as unverified, not as unconfigured.`, "info");
		}
	});

	pi.registerCommand("aos-status", {
		description: "AOS health, failing checks and daemon status",
		handler: async (_args, ctx) => {
			await showStatus(ctx);
		},
	});

	pi.registerCommand("aos", {
		description: "AOS menu: status, dashboard, or the command for a terminal action",
		handler: async (_args, ctx) => {
			const items: SelectItem[] = [
				{ value: "status", label: "Status", description: "run aos-doctor and show failing checks" },
				{ value: "update", label: "Skills & MCPs aktualisieren", description: "runs outside this session" },
				{ value: "install", label: "AOS CLI nachinstallieren", description: "runs outside this session" },
				{ value: "uninstall", label: "AOS deinstallieren", description: "runs outside this session" },
			];

			const choice = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
				container.addChild(new Text(theme.fg("accent", theme.bold("AOS"))));

				const list = new SelectList(items, items.length, {
					selectedPrefix: (t) => theme.fg("accent", t),
					selectedText: (t) => theme.fg("accent", t),
					description: (t) => theme.fg("muted", t),
				});
				list.onSelect = (item) => done(item.value);
				list.onCancel = () => done(null);
				container.addChild(list);

				container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")));
				container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));

				return {
					render(width: number) {
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(data: string) {
						list.handleInput(data);
						tui.requestRender();
					},
				};
			});

			if (choice === "status") {
				await showStatus(ctx);
				return;
			}
			if (!choice) return;

			// The installer animates and prompts; running it with inherited stdio
			// inside pi's TUI corrupts both renderers. Report the command instead.
			const commands: Record<string, string> = {
				update: "aos",
				install: "aos",
				uninstall: "npx @hybridlabor-api/aos-uninstall",
			};
			ctx.ui.notify(`Run this in a separate terminal:  ${commands[choice]}`, "info");
		},
	});
}
