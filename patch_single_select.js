const fs = require('fs');
let code = fs.readFileSync('installer.js', 'utf8');

const oldFunc = `        const render = () => {
            if (drawnLines > 0) {
                process.stdout.write(\`\\x1B[${drawnLines}A\\x1B[J\`);
            }
            let output = \`\\n\${colors.cyan}\${colors.bold}\${title}\${colors.reset}\\n\`;
            options.forEach((opt, index) => {
                const label = opt.label || opt.name || opt;
                if (index === cursor) {
                    output += \`\${colors.cyan}\${colors.bold} > 🔘 \${label}\${colors.reset}\\n\`;
                } else {
                    output += \`   ⚪ \${label}\\n\`;
                }
            });
            output += \`\\n\${colors.dim}Use UP/DOWN arrows to navigate, ENTER to confirm.\${colors.reset}\\n\`;

            const lines = output.split('\\n');
            drawnLines = lines.length - 1;
            process.stdout.write(output);
        };

        const onKeypress = (str, key) => {
            if (!key) return;
            if (key.name === 'up' || key.name === 'k') {
                cursor = cursor > 0 ? cursor - 1 : options.length - 1;
                render();
            } else if (key.name === 'down' || key.name === 'j') {
                cursor = cursor < options.length - 1 ? cursor + 1 : 0;
                render();
            } else if (key.name === 'return' || key.name === 'enter') {
                cleanup();
                console.log("");
                resolve(options[cursor].value !== undefined ? options[cursor].value : options[cursor]);
            } else if (key.ctrl && key.name === 'c') {
                cleanup();
                process.exit(0);
            }
        };`;

const newFunc = `        let selectedIndex = defaultIndex;

        const render = () => {
            if (drawnLines > 0) {
                process.stdout.write(\`\\x1B[${drawnLines}A\\x1B[J\`);
            }
            let output = \`\\n\${colors.cyan}\${colors.bold}\${title}\${colors.reset}\\n\`;
            options.forEach((opt, index) => {
                const label = opt.label || opt.name || opt;
                const isSelected = index === selectedIndex ? \`\${colors.green}x\${colors.reset}\` : ' ';
                if (index === cursor) {
                    output += \`\${colors.cyan}\${colors.bold} > [\${isSelected}] \${label}\${colors.reset}\\n\`;
                } else {
                    output += \`   [\${isSelected}] \${label}\\n\`;
                }
            });
            output += \`\\n\${colors.dim}Use UP/DOWN arrows to navigate, SPACE to select, ENTER to confirm.\${colors.reset}\\n\`;

            const lines = output.split('\\n');
            drawnLines = lines.length - 1;
            process.stdout.write(output);
        };

        const onKeypress = (str, key) => {
            if (!key) return;
            if (key.name === 'up' || key.name === 'k') {
                cursor = cursor > 0 ? cursor - 1 : options.length - 1;
                render();
            } else if (key.name === 'down' || key.name === 'j') {
                cursor = cursor < options.length - 1 ? cursor + 1 : 0;
                render();
            } else if (key.name === 'space') {
                selectedIndex = cursor;
                render();
            } else if (key.name === 'return' || key.name === 'enter') {
                cleanup();
                console.log("");
                resolve(options[selectedIndex].value !== undefined ? options[selectedIndex].value : options[selectedIndex]);
            } else if (key.ctrl && key.name === 'c') {
                cleanup();
                process.exit(0);
            }
        };`;

code = code.replace(oldFunc, newFunc);
fs.writeFileSync('installer.js', code);
