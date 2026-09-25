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
