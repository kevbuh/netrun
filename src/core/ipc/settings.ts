import { ipcMain } from 'electron';
import * as settingsQueries from '../db/queries/settings.js';

export function registerSettingsIPC(): void {
  ipcMain.handle('db:settings-get', (_event, key: string) => {
    return settingsQueries.getSetting(key);
  });

  ipcMain.handle('db:settings-set', (_event, key: string, value: string) => {
    settingsQueries.setSetting(key, value);
  });

  ipcMain.handle('db:settings-all', () => {
    return settingsQueries.getAllSettings();
  });

  ipcMain.handle('db:settings-delete', (_event, key: string) => {
    settingsQueries.deleteSetting(key);
  });
}
