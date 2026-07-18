const fs = require('fs');
const code = fs.readFileSync('static/js/views/chat.js', 'utf8');
const lines = code.split('\n');

// Find method boundaries
let depth = 0;
let inMethod = false;
let methodStart = 0;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
        if (line[j] === '{') depth++;
        if (line[j] === '}') depth--;
    }
    if (depth === 0 && line.trim().endsWith(',') && !line.trim().startsWith('//')) {
        // This is likely a method boundary
        console.log(`Method boundary at line ${i+1}: ${line.trim().substring(0, 60)}`);
    }
}

console.log(`\nFinal depth: ${depth}`);
