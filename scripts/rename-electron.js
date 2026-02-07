#!/usr/bin/env node
/**
 * Renames the Electron .app bundle to "Aether" so macOS shows the correct
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

if (currentName === 'Aether') {
  console.log('rename-electron: already named Aether');
  process.exit(0);
}

const plist = path.join(dist, currentApp, 'Contents', 'Info.plist');

// Patch Info.plist
execSync(`plutil -replace CFBundleName -string "Aether" "${plist}"`);
execSync(`plutil -replace CFBundleDisplayName -string "Aether" "${plist}"`);

// Rename .app bundle
fs.renameSync(path.join(dist, currentApp), path.join(dist, 'Aether.app'));

// Update path.txt so Electron module resolves the binary
const pathContent = fs.readFileSync(pathFile, 'utf-8');
fs.writeFileSync(pathFile, pathContent.replace(currentApp, 'Aether.app'));

console.log(`rename-electron: ${currentName} → Aether`);
