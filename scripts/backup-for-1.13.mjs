import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSettingsBackup } from '../src/shared/settings-backup.ts';

/** Downgrading the extension requires a four-group backup understood by 1.13. */
export function backupFor113(text) {
  const backup = parseSettingsBackup(text);
  const { security: _security, ...groups } = backup.settings.groups;
  return { ...backup, version: 1, settings: { ...backup.settings, groups } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , input, output] = process.argv;
  if (!input || !output || process.argv.length !== 4) throw new Error('Dùng: node scripts/backup-for-1.13.mjs bản-sao-lưu.json bản-tương-thích-1.13.json');
  const backup = backupFor113(await readFile(input, 'utf8'));
  await writeFile(output, JSON.stringify(backup, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Đã tạo ${resolve(output)}. Nhập tệp này trong Cài đặt Safora 1.13 sau khi khôi phục tiện ích. Tệp giữ ngoại lệ/quy tắc/nhóm cũ, bỏ riêng lựa chọn URL độc hại chưa có trong 1.13.`);
}
