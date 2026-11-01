const fs = require('fs');
let code = fs.readFileSync('mcp_picks.json', 'utf8');

code = code.replace(
    /"name": "bdb_resolume_official_mcp",\s*"requires": \{\s*"app": "resolume"\s*\}/,
    `"name": "bdb_resolume_official_mcp",
          "requires": {
            "app": "resolume",
            "minVersion": "7.26.0"
          }`
);

fs.writeFileSync('mcp_picks.json', code);
