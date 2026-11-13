// UI strings, English and German. Every key must exist in both languages (test/i18n.test.mjs).
export const STRINGS = {
  en: {
    'nav.home': 'Home', 'nav.store': 'Store', 'nav.services': 'Services', 'nav.projects': 'Projects', 'nav.secrets': 'Secrets', 'nav.settings': 'Settings',
    'nav.label': 'Main navigation',
    'common.refresh': 'Refresh', 'common.loading': 'Loading…', 'common.cancelled': 'Cancelled.', 'common.cancel': 'Cancel', 'common.failed': 'Failed: {e}', 'common.retry': 'Try again',
    'common.raw': 'The command did not return JSON. Raw output:', 'common.none': '–',
    'home.title': 'Home', 'home.lede': 'Status of AOS on this computer.',
    'home.services': 'Services', 'home.servicesUp': '{up} of {total} up', 'home.servicesDown': 'Down: {list}',
    'home.doctor': 'Doctor', 'home.doctorRun': 'Run doctor', 'home.doctorRunning': 'Running doctor… this can take a minute.',
    'home.doctorOk': 'All {n} checks passed', 'home.doctorBad': '{fail} failed, {warn} warnings', 'home.doctorIdle': 'Not run yet.',
    'home.version': 'Installed', 'home.notInstalled': 'AOS is not installed', 'home.updateAvailable': 'Update available: {v}', 'home.upToDate': 'Up to date',
    'home.elevated': 'Running as administrator/root: changes are refused.',
    'store.title': 'Store', 'store.lede': 'Skills, agents and MCP servers from the AOS hub. The hub opens in its own window inside the app.',
    'store.open': 'Open store', 'store.opening': 'Starting the hub…', 'store.opened': 'Store window is open.',
    'store.installed': 'Installed skills', 'store.packs': 'Packs', 'store.noSkills': 'No skills installed yet.',
    'services.title': 'Services', 'services.lede': 'Background services AOS runs for your agents.',
    'services.restart': 'Restart', 'services.restartPrompt': 'Type {id} to confirm the restart', 'services.restartGo': 'Restart now', 'services.restartMismatch': 'Type the service id exactly.',
    'services.restarting': 'Restarting {id}…', 'services.restarted': '{id} restarted.',
    'services.up': 'up', 'services.down': 'down', 'services.unknown': 'unknown',
    'services.gateway': 'Gateway upstreams', 'services.gatewayRunning': 'Gateway running on 127.0.0.1:{port}', 'services.gatewayDown': 'Gateway not running',
    'services.gatewayUnavailable': 'Gateway status unavailable: {e}', 'services.add': 'Add', 'services.remove': 'Remove', 'services.notSelected': 'not selected',
    'services.ok': 'ok', 'services.starting': 'starting', 'services.degraded': 'degraded', 'services.failing': 'failing', 'services.working': 'Working…',
    'projects.title': 'Projects', 'projects.lede': 'Repositories in your workspace root. Read-only.', 'projects.count': '{n} projects in {root}',
    'projects.empty': 'No repositories found in the workspace root.', 'projects.wiki': 'wiki', 'projects.noWiki': 'no wiki', 'projects.clean': 'clean',
    'projects.changes': '{n} changes', 'projects.notGit': 'not a git repo', 'projects.gitUnknown': 'git state unknown', 'projects.noMeta': 'no .aos/project.json',
    'projects.slug': 'slug', 'projects.domain': 'domain',
    'secrets.title': 'Secrets', 'secrets.lede': 'API keys in ~/.aos/secrets.env for every agent and MCP server. Values are write-only: they are never shown, logged or sent anywhere.',
    'secrets.name': 'Name', 'secrets.value': 'Value', 'secrets.set': 'set', 'secrets.empty': 'empty', 'secrets.remove': 'Remove', 'secrets.save': 'Save',
    'secrets.setTitle': 'Set a value', 'secrets.saved': '{name} saved.', 'secrets.removed': '{name} removed.', 'secrets.none': 'No secrets stored yet.',
    'settings.title': 'Settings', 'settings.lede': 'Language, install and maintenance.', 'settings.language': 'Language',
    'settings.lifecycle': 'Install and update', 'settings.install': 'Install', 'settings.update': 'Update', 'settings.repair': 'Repair',
    'settings.running': '{kind} running… this can take several minutes.',
    'settings.agents': 'Global AGENTS.md', 'settings.agentsHint': 'Rules for every agent harness. AOS updates rewrite the blocks between its aos: markers; edit outside them. A backup is written before every save.',
    'settings.reload': 'Reload', 'settings.save': 'Save', 'settings.agentsMissing': '~/AGENTS.md does not exist yet; saving creates it.',
    'settings.advanced': 'Advanced (read-only)', 'settings.router': 'Router', 'settings.memory': 'Memory',
  },
  de: {
    'nav.home': 'Start', 'nav.store': 'Store', 'nav.services': 'Dienste', 'nav.projects': 'Projekte', 'nav.secrets': 'Secrets', 'nav.settings': 'Einstellungen',
    'nav.label': 'Hauptnavigation',
    'common.refresh': 'Aktualisieren', 'common.loading': 'Lädt…', 'common.cancelled': 'Abgebrochen.', 'common.cancel': 'Abbrechen', 'common.failed': 'Fehlgeschlagen: {e}', 'common.retry': 'Erneut versuchen',
    'common.raw': 'Der Befehl hat kein JSON geliefert. Rohausgabe:', 'common.none': '–',
    'home.title': 'Start', 'home.lede': 'Status von AOS auf diesem Rechner.',
    'home.services': 'Dienste', 'home.servicesUp': '{up} von {total} laufen', 'home.servicesDown': 'Aus: {list}',
    'home.doctor': 'Doctor', 'home.doctorRun': 'Doctor ausführen', 'home.doctorRunning': 'Doctor läuft… das kann eine Minute dauern.',
    'home.doctorOk': 'Alle {n} Prüfungen bestanden', 'home.doctorBad': '{fail} fehlgeschlagen, {warn} Warnungen', 'home.doctorIdle': 'Noch nicht ausgeführt.',
    'home.version': 'Installiert', 'home.notInstalled': 'AOS ist nicht installiert', 'home.updateAvailable': 'Update verfügbar: {v}', 'home.upToDate': 'Aktuell',
    'home.elevated': 'Läuft als Administrator/root: Änderungen werden abgelehnt.',
    'store.title': 'Store', 'store.lede': 'Skills, Agents und MCP-Server aus dem AOS-Hub. Der Hub öffnet sich in einem eigenen Fenster in der App.',
    'store.open': 'Store öffnen', 'store.opening': 'Hub startet…', 'store.opened': 'Store-Fenster ist offen.',
    'store.installed': 'Installierte Skills', 'store.packs': 'Pakete', 'store.noSkills': 'Noch keine Skills installiert.',
    'services.title': 'Dienste', 'services.lede': 'Hintergrunddienste, die AOS für deine Agents betreibt.',
    'services.restart': 'Neu starten', 'services.restartPrompt': 'Zum Bestätigen {id} eintippen', 'services.restartGo': 'Jetzt neu starten', 'services.restartMismatch': 'Die Dienst-ID genau eintippen.',
    'services.restarting': '{id} wird neu gestartet…', 'services.restarted': '{id} neu gestartet.',
    'services.up': 'läuft', 'services.down': 'aus', 'services.unknown': 'unbekannt',
    'services.gateway': 'Gateway-Upstreams', 'services.gatewayRunning': 'Gateway läuft auf 127.0.0.1:{port}', 'services.gatewayDown': 'Gateway läuft nicht',
    'services.gatewayUnavailable': 'Gateway-Status nicht verfügbar: {e}', 'services.add': 'Hinzufügen', 'services.remove': 'Entfernen', 'services.notSelected': 'nicht ausgewählt',
    'services.ok': 'ok', 'services.starting': 'startet', 'services.degraded': 'eingeschränkt', 'services.failing': 'fehlerhaft', 'services.working': 'Arbeitet…',
    'projects.title': 'Projekte', 'projects.lede': 'Repositories im Workspace-Ordner. Nur lesen.', 'projects.count': '{n} Projekte in {root}',
    'projects.empty': 'Keine Repositories im Workspace-Ordner gefunden.', 'projects.wiki': 'Wiki', 'projects.noWiki': 'kein Wiki', 'projects.clean': 'sauber',
    'projects.changes': '{n} Änderungen', 'projects.notGit': 'kein Git-Repo', 'projects.gitUnknown': 'Git-Status unbekannt', 'projects.noMeta': 'keine .aos/project.json',
    'projects.slug': 'Slug', 'projects.domain': 'Domain',
    'secrets.title': 'Secrets', 'secrets.lede': 'API-Keys in ~/.aos/secrets.env für alle Agents und MCP-Server. Werte sind nur schreibbar: sie werden nie angezeigt, geloggt oder gesendet.',
    'secrets.name': 'Name', 'secrets.value': 'Wert', 'secrets.set': 'gesetzt', 'secrets.empty': 'leer', 'secrets.remove': 'Entfernen', 'secrets.save': 'Speichern',
    'secrets.setTitle': 'Wert setzen', 'secrets.saved': '{name} gespeichert.', 'secrets.removed': '{name} entfernt.', 'secrets.none': 'Noch keine Secrets gespeichert.',
    'settings.title': 'Einstellungen', 'settings.lede': 'Sprache, Installation und Wartung.', 'settings.language': 'Sprache',
    'settings.lifecycle': 'Installieren und aktualisieren', 'settings.install': 'Installieren', 'settings.update': 'Aktualisieren', 'settings.repair': 'Reparieren',
    'settings.running': '{kind} läuft… das kann einige Minuten dauern.',
    'settings.agents': 'Globale AGENTS.md', 'settings.agentsHint': 'Regeln für alle Agent-Harnesses. AOS-Updates überschreiben die Blöcke zwischen den aos:-Markern; außerhalb davon bearbeiten. Vor jedem Speichern wird ein Backup geschrieben.',
    'settings.reload': 'Neu laden', 'settings.save': 'Speichern', 'settings.agentsMissing': '~/AGENTS.md gibt es noch nicht; Speichern legt sie an.',
    'settings.advanced': 'Erweitert (nur lesen)', 'settings.router': 'Router', 'settings.memory': 'Memory',
  },
};

export const LANGS = ['en', 'de'];

/** Picks 'de' or 'en' from a stored choice, then the browser language list. */
export function detectLang(stored, navigatorLanguages = []) {
  if (LANGS.includes(stored)) return stored;
  for (const l of navigatorLanguages) {
    const base = String(l || '').toLowerCase().split('-')[0];
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

/** Translate a key with {name} placeholders; falls back to English, then to the key. */
export function t(lang, key, vars = {}) {
  const table = STRINGS[lang] || STRINGS.en;
  const s = table[key] ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
