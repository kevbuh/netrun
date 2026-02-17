import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getDb } from '../db/connection.js';
import { getUserVaultPath } from './shared.js';

export function registerDevIPC(): void {
  const { execFileSync } = require('child_process') as typeof import('child_process');
  // From dist/main/ipc/ we need ../../.. to reach project root
  const gitRoot = path.resolve(__dirname, '..', '..', '..');

  ipcMain.handle('db:dev-git-log', (_event, offset = 0, limit = 20) => {
    try {
      limit = Math.min(limit, 100);
      const sep = '\x1f';
      const r = execFileSync('git', ['log', `--skip=${offset}`, `-${limit}`, `--format=COMMIT${sep}%H${sep}%an${sep}%ad${sep}%s`, '--date=iso', '--shortstat'], { cwd: gitRoot, timeout: 10_000, encoding: 'utf-8' });
      const gitLog: any[] = [];
      let current: any = null;
      for (const line of r.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('COMMIT' + sep)) {
          const parts = trimmed.split(sep, 5);
          if (parts.length === 5) {
            current = { sha: parts[1].slice(0, 8), author: parts[2], date: parts[3], message: parts[4], ins: 0, del: 0 };
            gitLog.push(current);
          }
        } else if (current && trimmed.includes('changed')) {
          const mIns = trimmed.match(/(\d+) insertion/);
          const mDel = trimmed.match(/(\d+) deletion/);
          current.ins = mIns ? parseInt(mIns[1]) : 0;
          current.del = mDel ? parseInt(mDel[1]) : 0;
          current = null;
        }
      }
      return { git_log: gitLog, has_more: gitLog.length === limit };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:dev-stats', () => {
    try {
      const srcDir = path.resolve(gitRoot, 'src');
      const db = getDb();
      const users = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
      const activeSess = (db.prepare('SELECT COUNT(*) as c FROM sessions WHERE expires > ?').get(Date.now() / 1000) as any).c;

      let totalLoc = 0, coreLoc = 0, testLoc = 0, fileCount = 0;
      const walkLoc = (dir: string) => {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (['node_modules', '.git', '__pycache__', 'experiments', 'uploads'].includes(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) { walkLoc(full); continue; }
          if (!['.js', '.py', '.css', '.html'].some(e => entry.name.endsWith(e))) continue;
          try {
            const lines = fs.readFileSync(full, 'utf-8').split('\n').length;
            totalLoc += lines; fileCount++;
            const rel = path.relative(srcDir, full);
            if (rel.startsWith('tests') || entry.name.includes('.test.') || entry.name.includes('.spec.') || entry.name.startsWith('test_')) {
              testLoc += lines;
            } else {
              coreLoc += lines;
            }
          } catch { /* skip */ }
        }
      };
      walkLoc(srcDir);

      let commitsToday = 0, totalCommits = 0, projectAgeDays = 0, firstCommitDate = '';
      try {
        const today = new Date().toISOString().slice(0, 10) + 'T00:00:00';
        commitsToday = parseInt(execFileSync('git', ['rev-list', '--count', `--since=${today}`, 'HEAD'], { cwd: gitRoot, timeout: 5000, encoding: 'utf-8' }).trim()) || 0;
      } catch {}
      try {
        totalCommits = parseInt(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: gitRoot, timeout: 5000, encoding: 'utf-8' }).trim()) || 0;
      } catch {}
      try {
        const r = execFileSync('git', ['log', '--reverse', '--format=%ad', '--date=short'], { cwd: gitRoot, timeout: 10000, encoding: 'utf-8' });
        const lines = r.trim().split('\n');
        if (lines[0]) {
          firstCommitDate = lines[0];
          const fd = new Date(firstCommitDate);
          projectAgeDays = Math.max(1, Math.round((Date.now() - fd.getTime()) / 86400000));
        }
      } catch {}

      const gitLog: any[] = [];
      try {
        const sep = '\x1f';
        const r = execFileSync('git', ['log', '-20', `--format=COMMIT${sep}%H${sep}%an${sep}%ad${sep}%s`, '--date=iso', '--shortstat'], { cwd: gitRoot, timeout: 10000, encoding: 'utf-8' });
        let current: any = null;
        for (const line of r.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('COMMIT' + sep)) {
            const parts = trimmed.split(sep, 5);
            if (parts.length === 5) {
              current = { sha: parts[1].slice(0, 8), author: parts[2], date: parts[3], message: parts[4], ins: 0, del: 0 };
              gitLog.push(current);
            }
          } else if (current && trimmed.includes('changed')) {
            const mIns = trimmed.match(/(\d+) insertion/);
            const mDel = trimmed.match(/(\d+) deletion/);
            current.ins = mIns ? parseInt(mIns[1]) : 0;
            current.del = mDel ? parseInt(mDel[1]) : 0;
            current = null;
          }
        }
      } catch {}

      const commitsPerDay: any[] = [];
      try {
        const r = execFileSync('git', ['log', '--format=%ad', '--date=short', '--since=30 days ago'], { cwd: gitRoot, timeout: 10000, encoding: 'utf-8' });
        const counts: Record<string, number> = {};
        for (const d of r.trim().split('\n')) {
          const date = d.trim();
          if (date) counts[date] = (counts[date] || 0) + 1;
        }
        for (const date of Object.keys(counts).sort()) {
          commitsPerDay.push({ date, count: counts[date] });
        }
      } catch {}

      const ramMb = Math.round(process.memoryUsage().heapUsed / (1024 * 1024) * 10) / 10;
      let diskTotalGb = 0, diskUsedGb = 0, diskFreeGb = 0;
      try {
        const stat = fs.statfsSync('/');
        diskTotalGb = Math.round(stat.bsize * stat.blocks / (1024 ** 3) * 10) / 10;
        diskFreeGb = Math.round(stat.bsize * stat.bavail / (1024 ** 3) * 10) / 10;
        diskUsedGb = Math.round((diskTotalGb - diskFreeGb) * 10) / 10;
      } catch {}

      let projectBytes = 0;
      const walkSize = (dir: string) => {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (['node_modules', '.git', '__pycache__', 'experiments', 'uploads'].includes(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) { walkSize(full); }
          else { try { projectBytes += fs.statSync(full).size; } catch {} }
        }
      };
      walkSize(srcDir);
      const projectMb = Math.round(projectBytes / (1024 ** 2) * 10) / 10;

      const avgCommitsDay = projectAgeDays ? Math.round(totalCommits / projectAgeDays * 10) / 10 : 0;

      const locHistory: any[] = [];
      try {
        const r = execFileSync('git', ['log', '--format=%ad', '--date=short', '--numstat', '--since=30 days ago'], { cwd: gitRoot, timeout: 15000, encoding: 'utf-8' });
        const daily: Record<string, { added: number; deleted: number }> = {};
        let currentDate = '';
        for (const line of r.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            currentDate = trimmed;
            if (!daily[currentDate]) daily[currentDate] = { added: 0, deleted: 0 };
          } else if (currentDate) {
            const parts = trimmed.split('\t');
            if (parts.length >= 3 && parts[0] !== '-') {
              daily[currentDate].added += parseInt(parts[0]) || 0;
              daily[currentDate].deleted += parseInt(parts[1]) || 0;
            }
          }
        }
        const dates = Object.keys(daily).sort();
        let running = totalLoc;
        const dateLines: Record<string, number> = {};
        for (let i = dates.length - 1; i >= 0; i--) {
          dateLines[dates[i]] = running;
          running -= (daily[dates[i]].added - daily[dates[i]].deleted);
        }
        for (const d of dates) {
          locHistory.push({ date: d, lines: dateLines[d], added: daily[d].added, deleted: daily[d].deleted });
        }
      } catch { /* skip */ }

      const usageHistory: Record<string, Record<string, number>> = {};
      try {
        const thirtyDaysAgo = (Date.now() - 30 * 86400000) / 1000;
        const rows = db.prepare(
          "SELECT event, date(ts, 'unixepoch', 'localtime') as day, COUNT(*) as cnt FROM usage_log WHERE ts > ? GROUP BY event, day ORDER BY day"
        ).all(thirtyDaysAgo) as any[];
        for (const row of rows) {
          if (!usageHistory[row.day]) usageHistory[row.day] = {};
          usageHistory[row.day][row.event] = row.cnt;
        }
      } catch { /* skip */ }

      return {
        users, active_sessions: activeSess,
        total_loc: totalLoc, core_loc: coreLoc, test_loc: testLoc, files: fileCount,
        commits_today: commitsToday, total_commits: totalCommits,
        project_age_days: projectAgeDays, first_commit_date: firstCommitDate,
        avg_commits_day: avgCommitsDay,
        loc_history: locHistory,
        usage_history: usageHistory,
        git_log: gitLog, commits_per_day: commitsPerDay,
        ram_mb: ramMb, disk_total_gb: diskTotalGb, disk_used_gb: diskUsedGb, disk_free_gb: diskFreeGb,
        project_mb: projectMb,
      };
    } catch (e: any) { return { error: e.message ?? String(e) }; }
  });

  ipcMain.handle('db:function-registry', () => {
    try {
      execFileSync('node', ['scripts/function-registry.js'], { cwd: gitRoot, timeout: 30_000 });
      const jsonPath = path.join(gitRoot, 'coverage', 'function-registry.json');
      if (!fs.existsSync(jsonPath)) return { error: 'Report file not found' };
      return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    } catch (e: any) {
      if (e.killed) return { error: 'Analysis timed out' };
      return { error: e.message ?? String(e) };
    }
  });

  ipcMain.handle('db:validate-feeds', () => {
    try {
      const scriptPath = path.join(gitRoot, 'scripts', 'validate-feeds.js');
      const result = execFileSync('node', [scriptPath, '--json'], { timeout: 10_000, encoding: 'utf-8' });
      return JSON.parse(result);
    } catch (e: any) {
      if (e.killed) return { status: 'error', message: 'Validation timed out' };
      if (e.stdout) try { return JSON.parse(e.stdout); } catch {}
      return { status: 'error', message: e.message ?? String(e) };
    }
  });

  ipcMain.handle('db:validate-load-order', () => {
    try {
      const scriptPath = path.join(gitRoot, 'scripts', 'function-registry.js');
      const result = execFileSync('node', [scriptPath, '--check-load-order', '--json'], { cwd: gitRoot, timeout: 30_000, encoding: 'utf-8' });
      return JSON.parse(result);
    } catch (e: any) {
      if (e.killed) return { status: 'error', message: 'Analysis timed out' };
      return { status: 'error', message: e.message ?? String(e) };
    }
  });

  ipcMain.handle('db:dependency-graph', (_event, level = 'file') => {
    try {
      const scriptPath = path.join(gitRoot, 'scripts', 'function-registry.js');
      execFileSync('node', [scriptPath], { cwd: gitRoot, timeout: 30_000 });
      const jsonPath = path.join(gitRoot, 'coverage', 'function-registry.json');
      if (!fs.existsSync(jsonPath)) return { status: 'error', message: 'Report file not found' };
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

      if (level === 'function') {
        const nodes: any[] = [];
        const functions = data.functions ?? {};
        for (const [funcName, funcData] of Object.entries(functions) as any) {
          const defs = funcData.definitions ?? [];
          if (!defs.length) continue;
          const primaryDef = defs[0];
          nodes.push({
            id: funcName, file: primaryDef.file ?? '', line: primaryDef.line ?? 0,
            callCount: funcData.callCount ?? 0, type: primaryDef.type ?? 'function',
            isGlobal: primaryDef.isGlobal ?? false, definitionCount: defs.length,
          });
        }
        const edgeMap: Record<string, number> = {};
        for (const [funcName, funcData] of Object.entries(functions) as any) {
          for (const site of (funcData.callSites ?? [])) {
            let callerFunc: string | null = null;
            let bestDist = Infinity;
            for (const [fn, fd] of Object.entries(functions) as any) {
              for (const defn of (fd.definitions ?? [])) {
                if (defn.file === site.file && defn.line <= site.line) {
                  const dist = site.line - defn.line;
                  if (dist < bestDist) { bestDist = dist; callerFunc = fn; }
                }
              }
            }
            if (callerFunc && callerFunc !== funcName) {
              const key = `${callerFunc}|${funcName}`;
              edgeMap[key] = (edgeMap[key] ?? 0) + 1;
            }
          }
        }
        const edges = Object.entries(edgeMap).map(([key, calls]) => {
          const [source, target] = key.split('|');
          return { source, target, calls };
        });
        return { status: 'ok', level: 'function', nodes, edges };
      }

      // File-level graph
      let loadData: any = {};
      try {
        const loadResult = execFileSync('node', [scriptPath, '--check-load-order', '--json'], { cwd: gitRoot, timeout: 30_000, encoding: 'utf-8' });
        loadData = JSON.parse(loadResult);
      } catch {}

      const nodes: any[] = [];
      const fileStats = data.files ?? {};
      const scriptOrder = loadData.scriptOrder ?? [];
      for (const [filename, stats] of Object.entries(fileStats) as any) {
        nodes.push({
          id: filename, functions: stats.functionCount ?? 0, loc: stats.loc ?? 0,
          order: scriptOrder.indexOf(filename) >= 0 ? scriptOrder.indexOf(filename) : 999,
        });
      }

      const edgeMap2: Record<string, { calls: number; severity: string | null }> = {};
      for (const ref of (loadData.forwardRefs ?? [])) {
        const source = ref.callFile;
        const target = ref.defFile;
        const severity = ref.severity ?? 'INFO';
        if (source && target && source !== target) {
          const key = `${source}|${target}`;
          if (!edgeMap2[key]) edgeMap2[key] = { calls: 0, severity };
          edgeMap2[key].calls++;
          if (severity === 'ERROR' || (severity === 'WARNING' && edgeMap2[key].severity === 'INFO')) {
            edgeMap2[key].severity = severity;
          }
        }
      }
      const functions = data.functions ?? {};
      for (const funcData of Object.values(functions) as any) {
        const defs = funcData.definitions ?? [];
        const callSites = funcData.callSites ?? [];
        if (!defs.length || !callSites.length) continue;
        const defFiles = new Set(defs.map((d: any) => d.file).filter(Boolean));
        for (const site of callSites) {
          if (!site.file) continue;
          for (const target of defFiles) {
            if (site.file !== target) {
              const key = `${site.file}|${target}`;
              if (!edgeMap2[key]) edgeMap2[key] = { calls: 0, severity: null };
              edgeMap2[key].calls++;
            }
          }
        }
      }
      const edges = Object.entries(edgeMap2).map(([key, d]) => {
        const [source, target] = key.split('|');
        return { source, target, calls: d.calls, severity: d.severity };
      });
      return { status: 'ok', level: 'file', nodes, edges };
    } catch (e: any) {
      if (e.killed) return { status: 'error', message: 'Analysis timed out' };
      return { status: 'error', message: e.message ?? String(e) };
    }
  });

  ipcMain.handle('db:vibe-git', (_event, googleId: string, cmd: string, body: Record<string, any>) => {
    const ALLOWED = new Set(['status', 'files', 'branches', 'log', 'stash', 'diff', 'show', 'reflog']);
    if (!ALLOWED.has(cmd)) return { error: 'Command not allowed' };
    const userVault = getUserVaultPath(googleId);

    if (!fs.existsSync(path.join(userVault, '.git'))) {
      try {
        execFileSync('git', ['init'], { cwd: userVault, timeout: 10_000 });
        execFileSync('git', ['add', '.'], { cwd: userVault, timeout: 10_000 });
        execFileSync('git', ['commit', '-m', 'Initial commit', '--allow-empty'], { cwd: userVault, timeout: 10_000 });
      } catch { /* ignore init errors */ }
    }

    const run = (args: string[], maxOutput = 50000): string | { error: string } => {
      try {
        const out = execFileSync('git', args, { cwd: userVault, timeout: 10_000, encoding: 'utf-8', maxBuffer: maxOutput + 1000 });
        return out.slice(0, maxOutput);
      } catch (e: any) {
        return { error: (e.stderr ?? e.message ?? String(e)).slice(0, 2000) };
      }
    };

    if (cmd === 'status') {
      const out = run(['status', '--porcelain', '-b']);
      if (typeof out !== 'string') return out;
      return { output: out };
    }
    if (cmd === 'files') {
      const changedOut = run(['status', '--porcelain']);
      const changed: Record<string, string> = {};
      if (typeof changedOut === 'string') {
        for (const line of changedOut.trim().split('\n')) {
          if (!line) continue;
          changed[line.slice(3)] = line.slice(0, 2).trim();
        }
      }
      const trackedOut = run(['ls-files']);
      if (typeof trackedOut !== 'string') return trackedOut;
      const files: any[] = [];
      const seen = new Set<string>();
      for (const [p, status] of Object.entries(changed)) {
        files.push({ status, path: p });
        seen.add(p);
      }
      for (const line of trackedOut.trim().split('\n')) {
        if (!line || seen.has(line)) continue;
        files.push({ status: ' ', path: line });
      }
      return { files };
    }
    if (cmd === 'branches') {
      const out = run(['branch', '-a', '--format=%(HEAD)%(refname:short)\t%(upstream:track)\t%(objectname:short)\t%(committerdate:relative)']);
      if (typeof out !== 'string') return out;
      const branches: any[] = [];
      for (const line of out.trim().split('\n')) {
        if (!line) continue;
        const current = line.startsWith('*');
        const parts = line.replace(/^\* ?/, '').split('\t');
        branches.push({ name: parts[0] ?? '', current, track: parts[1] ?? '', hash: parts[2] ?? '', date: parts[3] ?? '' });
      }
      return { branches };
    }
    if (cmd === 'log') {
      const branch = body.branch ?? '';
      const args = ['log', '--oneline', '--graph', '-50', '--format=%h\t%s\t%an\t%ar'];
      if (branch) args.push(branch);
      const out = run(args);
      if (typeof out !== 'string') return out;
      const commits: any[] = [];
      for (const line of out.trim().split('\n')) {
        if (!line) continue;
        const parts = line.split('\t');
        if (parts.length >= 4) {
          commits.push({ hash: parts[0].replace(/[* |/\\]/g, ''), subject: parts[1], author: parts[2], date: parts[3] });
        }
      }
      return { commits };
    }
    if (cmd === 'stash') {
      const out = run(['stash', 'list']);
      if (typeof out !== 'string') return out;
      return { entries: out.trim().split('\n').filter(Boolean) };
    }
    if (cmd === 'diff') {
      const file = body.file ?? '';
      const args = ['diff'];
      if (file) { args.push('--'); args.push(file); }
      const out = run(args);
      if (typeof out !== 'string') return out;
      let staged = run(['diff', '--cached', ...(file ? ['--', file] : [])]);
      if (typeof staged !== 'string') staged = '';
      let combined = '';
      if (staged) combined += '=== Staged ===\n' + staged + '\n';
      if (out) combined += '=== Unstaged ===\n' + out;
      if (!combined) combined = 'No changes';
      return { output: combined };
    }
    if (cmd === 'show') {
      const ref = body.ref ?? 'HEAD';
      if (!/^[a-zA-Z0-9_./@{}\-: ]+$/.test(ref)) return { error: 'Invalid ref' };
      const out = run(['show', '--stat', '--patch', ref]);
      if (typeof out !== 'string') return out;
      return { output: out };
    }
    if (cmd === 'reflog') {
      const out = run(['reflog', '--format=%h\t%gd\t%gs\t%ar', '-50']);
      if (typeof out !== 'string') return out;
      return { entries: out.trim().split('\n').filter(Boolean) };
    }
    return { error: 'Unknown command' };
  });
}
