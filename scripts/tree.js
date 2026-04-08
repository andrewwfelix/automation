#!/usr/bin/env node
/**
 * tree.js – Print directory tree for the automation folder, respecting .gitignore
 * 
 * Run from: C:\Users\andre\projects\automation
 * Usage:
 *   node scripts/tree.js
 *   node scripts/tree.js --depth 2
 *   node scripts/tree.js --full-path
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

// The root is the parent directory of the 'scripts' folder, i.e., the automation folder
const rootDir = path.resolve(__dirname, '..');

function parseGitignore(gitignorePath) {
    if (!fs.existsSync(gitignorePath)) return [];
    const content = fs.readFileSync(gitignorePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const patterns = [];
    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('#')) continue;
        if (line.endsWith('/')) line = line.slice(0, -1);
        patterns.push(line);
    }
    return patterns;
}

function isIgnored(relPath, patterns, isDir) {
    for (const pattern of patterns) {
        let regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '.');
        let target = pattern.includes('/') ? relPath : path.basename(relPath);
        const regex = new RegExp(`^${regexPattern}$`);
        if (regex.test(target)) return true;
        if (relPath === pattern || relPath.startsWith(pattern + '/')) return true;
    }
    return false;
}

async function buildTree(dir, currentDepth, maxDepth, relativePath, patterns, fullPathMode, prefix = '') {
    if (maxDepth !== undefined && currentDepth > maxDepth) return '';
    let result = '';
    const entries = await readdir(dir);
    const stats = await Promise.all(entries.map(async entry => {
        const full = path.join(dir, entry);
        const st = await stat(full);
        const rel = relativePath ? path.join(relativePath, entry) : entry;
        const ignored = isIgnored(rel, patterns, st.isDirectory());
        return { entry, full, st, rel, ignored };
    }));
    const visible = stats.filter(s => !s.ignored);
    visible.sort((a, b) => {
        if (a.st.isDirectory() && !b.st.isDirectory()) return -1;
        if (!a.st.isDirectory() && b.st.isDirectory()) return 1;
        return a.entry.localeCompare(b.entry);
    });
    for (let i = 0; i < visible.length; i++) {
        const { entry, full, st, rel } = visible[i];
        const isLast = i === visible.length - 1;
        const linePrefix = prefix + (isLast ? '└── ' : '├── ');
        const displayName = fullPathMode ? full : entry;
        result += linePrefix + displayName + (st.isDirectory() ? '/' : '') + '\n';
        if (st.isDirectory()) {
            const childPrefix = prefix + (isLast ? '    ' : '│   ');
            result += await buildTree(full, currentDepth + 1, maxDepth, rel, patterns, fullPathMode, childPrefix);
        }
    }
    return result;
}

async function main() {
    const args = process.argv.slice(2);
    let maxDepth = undefined;
    let fullPathMode = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--depth' && i+1 < args.length) {
            maxDepth = parseInt(args[i+1], 10);
            i++;
        } else if (args[i] === '--full-path') {
            fullPathMode = true;
        }
    }

    const gitignorePath = path.join(rootDir, '.gitignore');
    const patterns = parseGitignore(gitignorePath);
    if (patterns.length) console.log(`Loaded ${patterns.length} ignore patterns from .gitignore\n`);
    else console.log('No .gitignore found or empty. Showing all files.\n');

    console.log(`${rootDir}${fullPathMode ? '' : ' (relative to root)'}\n`);
    const treeStr = await buildTree(rootDir, 0, maxDepth, '', patterns, fullPathMode, '');
    console.log(treeStr);
}

main().catch(console.error);