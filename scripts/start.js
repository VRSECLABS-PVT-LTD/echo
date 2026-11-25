#!/usr/bin/env node
// Cross-platform launcher: starts Electron with a clean environment.
// (Editors like VS Code set ELECTRON_RUN_AS_NODE, which would make Electron run as plain Node.)
const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron'); // resolves to the Electron binary path when required from Node

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const entry = process.argv[2] || '.';
const child = spawn(electron, [entry, ...process.argv.slice(3)], { stdio: 'inherit', env, cwd: path.join(__dirname, '..') });
child.on('exit', (code) => process.exit(code ?? 0));
