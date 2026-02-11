#!/usr/bin/env node
/**
 * Renames the Electron .app bundle to "NetRun" so macOS shows the correct
 * name in the Dock and menu bar. Runs automatically via npm postinstall.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dist = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
const pathFile = path.join(__dirname, '..', 'node_modules', 'electron', 'path.txt');

// Find the current .app name
const apps = fs.readdirSync(dist).filter(f => f.endsWith('.app'));
if (apps.length === 0) {
  console.log('rename-electron: no .app found in electron/dist, skipping');
  process.exit(0);
}

const currentApp = apps[0];
const currentName = currentApp.replace('.app', '');

if (currentName === 'NetRun') {
  console.log('rename-electron: already named NetRun');
  process.exit(0);
}

const plist = path.join(dist, currentApp, 'Contents', 'Info.plist');

// Patch Info.plist
execSync(`plutil -replace CFBundleName -string "NetRun" "${plist}"`);
execSync(`plutil -replace CFBundleDisplayName -string "NetRun" "${plist}"`);

// Rename .app bundle
fs.renameSync(path.join(dist, currentApp), path.join(dist, 'NetRun.app'));

// Update path.txt so Electron module resolves the binary
const pathContent = fs.readFileSync(pathFile, 'utf-8');
fs.writeFileSync(pathFile, pathContent.replace(currentApp, 'NetRun.app'));

console.log(`rename-electron: ${currentName} → NetRun`);
