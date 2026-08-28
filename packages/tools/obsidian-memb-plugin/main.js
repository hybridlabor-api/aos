var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => MembSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var child_process = __toESM(require("child_process"));
var path = __toESM(require("path"));
var os = __toESM(require("os"));
var MembSyncPlugin = class extends import_obsidian.Plugin {
  async onload() {
    console.log("Loading memB AI Memory Sync Plugin");
    const ribbonIconEl = this.addRibbonIcon("brain-circuit", "Sync memB Knowledge Graph", (evt) => {
      this.syncMemBData();
    });
    this.addCommand({
      id: "sync-memb-data",
      name: "Sync memB Knowledge Graph",
      callback: () => {
        this.syncMemBData();
      }
    });
  }
  onunload() {
    console.log("Unloading memB AI Memory Sync Plugin");
  }
  async syncMemBData() {
    new import_obsidian.Notice("\u{1F9E0} Syncing memB local vector memories...");
    try {
      const dbDir = process.env.MEMB_DATA_DIR || path.join(os.homedir(), ".MemBDB");
      const dbPath = path.join(dbDir, "memb.db");
      const pythonScript = `
import sqlite3, json, sys
try:
    conn = sqlite3.connect('${dbPath.replace(/\\/g, "\\\\")}')
    cursor = conn.cursor()
    cursor.execute('SELECT id, collection, payload, created_at FROM memb_vectors;')
    rows = cursor.fetchall()
    conn.close()
    
    out = []
    for r in rows:
        try:
            p = json.loads(r[2])
        except:
            p = {"data": r[2]}
        out.append({
            "id": r[0],
            "project": p.get("project") or p.get("project_id") or "Global",
            "category": p.get("category") or "General",
            "data": p.get("data", ""),
            "created_at": r[3]
        })
    print(json.dumps(out))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
      child_process.exec(`python3 -c "${pythonScript.replace(/"/g, '\\"')}"`, { maxBuffer: 1024 * 1024 * 10 }, async (error, stdout, stderr) => {
        if (error) {
          new import_obsidian.Notice("\u274C Failed to run Python SQLite dump: " + error.message);
          return;
        }
        try {
          const data = JSON.parse(stdout);
          if (data.error) {
            new import_obsidian.Notice("\u274C memB DB Error: " + data.error);
            return;
          }
          await this.generateVaultFiles(data);
          new import_obsidian.Notice(`\u2705 Successfully synced ${data.length} memB entries into Obsidian!`);
        } catch (e) {
          new import_obsidian.Notice("\u274C Failed to parse memB data: " + e);
        }
      });
    } catch (error) {
      new import_obsidian.Notice("\u274C Plugin Error: " + error);
    }
  }
  async generateVaultFiles(entries) {
    const rootFolder = "memB_Knowledge_Graph";
    await this.ensureFolder(rootFolder);
    await this.ensureFolder(`${rootFolder}/Projects`);
    const tree = {};
    let totalMemories = 0;
    for (const entry of entries) {
      let p = entry.project || "Global";
      let c = entry.category || "General";
      if (c === "godmode") {
        p = "Global";
      }
      if (!tree[p])
        tree[p] = {};
      if (!tree[p][c])
        tree[p][c] = [];
      tree[p][c].push(entry);
      totalMemories++;
    }
    let godModeContent = `# \u{1F451} GOD MODE: Core Knowledge Base

`;
    godModeContent += `> **Total Ecosystem Memories:** ${totalMemories}

`;
    godModeContent += `## \u{1F30C} Projects

`;
    for (const proj of Object.keys(tree)) {
      godModeContent += `- [[${rootFolder}/Projects/${proj}/_Hub|Project: ${proj}]]
`;
    }
    await this.writeOrUpdateFile(`${rootFolder}/God_Mode.md`, godModeContent);
    for (const [proj, categories] of Object.entries(tree)) {
      await this.ensureFolder(`${rootFolder}/Projects/${proj}`);
      let pContent = `---
tags:
  - memB/project
---

# \u{1F680} Project: ${proj}

## Sub-Clusters
`;
      for (const cat of Object.keys(categories)) {
        pContent += `- [[${rootFolder}/Projects/${proj}/${cat}/_Hub|Category: ${cat}]]
`;
      }
      await this.writeOrUpdateFile(`${rootFolder}/Projects/${proj}/_Hub.md`, pContent);
      for (const [cat, items] of Object.entries(categories)) {
        await this.ensureFolder(`${rootFolder}/Projects/${proj}/${cat}`);
        let cContent = `---
tags:
  - memB/category
---

# \u{1F3F7}\uFE0F Category: ${cat}

`;
        const CLUSTER_SIZE = 25;
        if (items.length > CLUSTER_SIZE) {
          cContent += `## Memory Clusters
`;
          const numClusters = Math.ceil(items.length / CLUSTER_SIZE);
          for (let i = 0; i < numClusters; i++) {
            const clusterName = `Cluster_${i + 1}`;
            await this.ensureFolder(`${rootFolder}/Projects/${proj}/${cat}/${clusterName}`);
            cContent += `- [[${rootFolder}/Projects/${proj}/${cat}/${clusterName}/_Hub|${clusterName}]]
`;
            let clContent = `---
tags:
  - memB/cluster
---

# \u{1F30C} ${clusterName} (${cat})

## \u{1F9E0} Memories
`;
            const clusterItems = items.slice(i * CLUSTER_SIZE, (i + 1) * CLUSTER_SIZE);
            for (const item of clusterItems) {
              const title = this.getMemoryTitle(item.data, item.id);
              clContent += `- [[${rootFolder}/Projects/${proj}/${cat}/${clusterName}/${title}|${title.replace(/_/g, " ")}]]
`;
              await this.generateMemoryNode(item, `${rootFolder}/Projects/${proj}/${cat}/${clusterName}`, title);
            }
            await this.writeOrUpdateFile(`${rootFolder}/Projects/${proj}/${cat}/${clusterName}/_Hub.md`, clContent);
          }
        } else {
          cContent += `## \u{1F9E0} Memories
`;
          for (const item of items) {
            const title = this.getMemoryTitle(item.data, item.id);
            cContent += `- [[${rootFolder}/Projects/${proj}/${cat}/${title}|${title.replace(/_/g, " ")}]]
`;
            await this.generateMemoryNode(item, `${rootFolder}/Projects/${proj}/${cat}`, title);
          }
        }
        await this.writeOrUpdateFile(`${rootFolder}/Projects/${proj}/${cat}/_Hub.md`, cContent);
      }
    }
    await this.injectSexyGraphSettings();
  }
  async generateMemoryNode(item, folderPath, title) {
    let mContent = `---
id: "${item.id}"
date: "${item.created_at}"
tags:
  - memB/memory
---

`;
    mContent += `# \u{1F9E0} ${title.replace(/_/g, " ")}

`;
    mContent += `## \u{1F4DC} Payload

${item.data}
`;
    await this.writeOrUpdateFile(`${folderPath}/${title}.md`, mContent);
  }
  getMemoryTitle(data, id) {
    if (!data)
      return id.substring(0, 8);
    let clean = data.replace(/[^\w\säöüßÄÖÜ]/g, " ").replace(/\s+/g, " ").trim();
    let words = clean.split(" ").filter((w) => w.length > 2).slice(0, 4);
    if (words.length === 0)
      return id.substring(0, 8);
    return words.join("_") + "_" + id.substring(0, 4);
  }
  async injectSexyGraphSettings() {
    const configDir = this.app.vault.configDir || ".obsidian";
    const graphPath = `${configDir}/graph.json`;
    const sexyConfig = {
      "collapse-filter": true,
      "search": "",
      "showSearch": false,
      "searchItemExclude": "",
      "searchItemTags": false,
      "searchItemAttachment": false,
      "hideUnresolved": true,
      "showTags": false,
      "showAttachments": false,
      "hideOrphans": true,
      "collapse-color-groups": false,
      "colorGroups": [
        {
          "query": "path:memB_Knowledge_Graph/God_Mode.md",
          "color": { "a": 1, "rgb": 16766720 }
        },
        {
          "query": "tag:#memB/project",
          "color": { "a": 1, "rgb": 5291775 }
        },
        {
          "query": "tag:#memB/category",
          "color": { "a": 1, "rgb": 16733610 }
        },
        {
          "query": "tag:#memB/cluster",
          "color": { "a": 1, "rgb": 16733610 }
        },
        {
          "query": "tag:#memB/memory",
          "color": { "a": 1, "rgb": 8947967 }
        }
      ],
      "collapse-display": false,
      "showArrow": false,
      "textFadeMultiplier": -1,
      "nodeSizeMultiplier": 1.1,
      "lineSizeMultiplier": 0.5,
      "collapse-forces": false,
      "centerStrength": 0.5,
      "repelStrength": 18.5,
      "linkStrength": 1,
      "linkDistance": 90,
      "scale": 0.7,
      "close": false
    };
    try {
      await this.app.vault.adapter.write(graphPath, JSON.stringify(sexyConfig, null, 2));
    } catch (e) {
      console.error("Failed to inject graph settings:", e);
    }
  }
  async ensureFolder(folderPath) {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await this.app.vault.createFolder(folderPath);
    }
  }
  async writeOrUpdateFile(filePath, content) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof import_obsidian.TFile) {
      await this.app.vault.modify(file, content);
    } else {
      await this.app.vault.create(filePath, content);
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {});
