import { Plugin, Notice, TFile, TFolder } from 'obsidian';
import * as child_process from 'child_process';
import * as path from 'path';
import * as os from 'os';

export default class MembSyncPlugin extends Plugin {
    async onload() {
        console.log('Loading memB AI Memory Sync Plugin');

        // Add ribbon icon
        const ribbonIconEl = this.addRibbonIcon('brain-circuit', 'Sync memB Knowledge Graph', (evt: MouseEvent) => {
            this.syncMemBData();
        });

        // Add command to command palette
        this.addCommand({
            id: 'sync-memb-data',
            name: 'Sync memB Knowledge Graph',
            callback: () => {
                this.syncMemBData();
            }
        });
    }

    onunload() {
        console.log('Unloading memB AI Memory Sync Plugin');
    }

    async syncMemBData() {
        new Notice('🧠 Syncing memB local vector memories...');
        
        try {
            // Get Python path and DB path
            const dbDir = process.env.MEMB_DATA_DIR || path.join(os.homedir(), '.MemBDB');
            const dbPath = path.join(dbDir, 'memb.db');
            
            // Inline python script to dump sqlite table safely to JSON
            const pythonScript = `
import sqlite3, json, sys
try:
    conn = sqlite3.connect('${dbPath.replace(/\\/g, '\\\\')}')
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
                    new Notice('❌ Failed to run Python SQLite dump: ' + error.message);
                    return;
                }
                
                try {
                    const data = JSON.parse(stdout);
                    if (data.error) {
                        new Notice('❌ memB DB Error: ' + data.error);
                        return;
                    }
                    
                    await this.generateVaultFiles(data);
                    new Notice(`✅ Successfully synced ${data.length} memB entries into Obsidian!`);
                    
                } catch (e) {
                    new Notice('❌ Failed to parse memB data: ' + e);
                }
            });
            
        } catch (error) {
            new Notice('❌ Plugin Error: ' + error);
        }
    }
    
    async generateVaultFiles(entries: any[]) {
        const rootFolder = "memB_Knowledge_Graph";
        
        // Ensure root folder
        await this.ensureFolder(rootFolder);
        await this.ensureFolder(`${rootFolder}/Projects`);
        
        // 1. Build the Data Tree
        const tree: Record<string, Record<string, any[]>> = {};
        let totalMemories = 0;
        
        for (const entry of entries) {
            let p = entry.project || "Global";
            let c = entry.category || "General";
            if (c === "godmode") {
                p = "Global"; // Force godmode into Global
            }
            
            if (!tree[p]) tree[p] = {};
            if (!tree[p][c]) tree[p][c] = [];
            tree[p][c].push(entry);
            totalMemories++;
        }
        
        // 2. Generate God Mode (Level 0) - Links to Projects
        let godModeContent = `# 👑 GOD MODE: Core Knowledge Base\n\n`;
        godModeContent += `> **Total Ecosystem Memories:** ${totalMemories}\n\n`;
        godModeContent += `## 🌌 Projects\n\n`;
        
        for (const proj of Object.keys(tree)) {
            godModeContent += `- [[${rootFolder}/Projects/${proj}/_Hub|Project: ${proj}]]\n`;
        }
        await this.writeOrUpdateFile(`${rootFolder}/God_Mode.md`, godModeContent);
        
        // 3. Generate Strict Top-Down Hierarchy
        for (const [proj, categories] of Object.entries(tree)) {
            await this.ensureFolder(`${rootFolder}/Projects/${proj}`);
            
            // Project Hub (Level 1) - Links to Categories
            let pContent = `---\ntags:\n  - memB/project\n---\n\n# 🚀 Project: ${proj}\n\n## Sub-Clusters\n`;
            for (const cat of Object.keys(categories)) {
                pContent += `- [[${rootFolder}/Projects/${proj}/${cat}/_Hub|Category: ${cat}]]\n`;
            }
            await this.writeOrUpdateFile(`${rootFolder}/Projects/${proj}/_Hub.md`, pContent);
            
            for (const [cat, items] of Object.entries(categories)) {
                await this.ensureFolder(`${rootFolder}/Projects/${proj}/${cat}`);
                
                // Category Hub (Level 2) - Links to Clusters or Memories
                let cContent = `---\ntags:\n  - memB/category\n---\n\n# 🏷️ Category: ${cat}\n\n`;
                
                const CLUSTER_SIZE = 25;
                if (items.length > CLUSTER_SIZE) {
                    cContent += `## Memory Clusters\n`;
                    const numClusters = Math.ceil(items.length / CLUSTER_SIZE);
                    
                    for (let i = 0; i < numClusters; i++) {
                        const clusterName = `Cluster_${i + 1}`;
                        await this.ensureFolder(`${rootFolder}/Projects/${proj}/${cat}/${clusterName}`);
                        cContent += `- [[${rootFolder}/Projects/${proj}/${cat}/${clusterName}/_Hub|${clusterName}]]\n`;
                        
                        // Cluster Hub (Level 3) - Links to Memories
                        let clContent = `---\ntags:\n  - memB/cluster\n---\n\n# 🌌 ${clusterName} (${cat})\n\n## 🧠 Memories\n`;
                        
                        const clusterItems = items.slice(i * CLUSTER_SIZE, (i + 1) * CLUSTER_SIZE);
                        for (const item of clusterItems) {
                            const title = this.getMemoryTitle(item.data, item.id);
                            clContent += `- [[${rootFolder}/Projects/${proj}/${cat}/${clusterName}/${title}|${title.replace(/_/g, ' ')}]]\n`;
                            await this.generateMemoryNode(item, `${rootFolder}/Projects/${proj}/${cat}/${clusterName}`, title);
                        }
                        await this.writeOrUpdateFile(`${rootFolder}/Projects/${proj}/${cat}/${clusterName}/_Hub.md`, clContent);
                    }
                } else {
                    cContent += `## 🧠 Memories\n`;
                    for (const item of items) {
                        const title = this.getMemoryTitle(item.data, item.id);
                        cContent += `- [[${rootFolder}/Projects/${proj}/${cat}/${title}|${title.replace(/_/g, ' ')}]]\n`;
                        await this.generateMemoryNode(item, `${rootFolder}/Projects/${proj}/${cat}`, title);
                    }
                }
                
                await this.writeOrUpdateFile(`${rootFolder}/Projects/${proj}/${cat}/_Hub.md`, cContent);
            }
        }
        
        // 4. Inject Sexy Graph Settings
        await this.injectSexyGraphSettings();
    }
    
    async generateMemoryNode(item: any, folderPath: string, title: string) {
        let mContent = `---\nid: "${item.id}"\ndate: "${item.created_at}"\ntags:\n  - memB/memory\n---\n\n`;
        mContent += `# 🧠 ${title.replace(/_/g, ' ')}\n\n`;
        mContent += `## 📜 Payload\n\n${item.data}\n`;
        await this.writeOrUpdateFile(`${folderPath}/${title}.md`, mContent);
    }
    
    getMemoryTitle(data: string, id: string): string {
        if (!data) return id.substring(0, 8);
        // Clean up markdown and extract 3-4 meaningful words
        let clean = data.replace(/[^\w\säöüßÄÖÜ]/g, ' ').replace(/\s+/g, ' ').trim();
        let words = clean.split(' ').filter(w => w.length > 2).slice(0, 4);
        
        if (words.length === 0) return id.substring(0, 8);
        
        // Combine words and append a tiny ID slice to guarantee uniqueness
        return words.join('_') + "_" + id.substring(0, 4);
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
            "linkStrength": 1.0,
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
    
    async ensureFolder(folderPath: string) {
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!folder) {
            await this.app.vault.createFolder(folderPath);
        }
    }
    
    async writeOrUpdateFile(filePath: string, content: string) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.app.vault.modify(file, content);
        } else {
            await this.app.vault.create(filePath, content);
        }
    }
}
