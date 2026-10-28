/** Translate a known library diagnostic without rewriting arbitrary rules or URLs. */
export function uiDiagnosticText(message: string): string {
  return message.replaceAll(
    'Invalid HTML filtering rule: Mixed AdGuard and uBlock syntax',
    'Quy tắc lọc HTML không hợp lệ: đang trộn các cú pháp không tương thích.',
  );
}
