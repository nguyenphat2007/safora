import { LogicalExpressionParser, LogicalExpressionUtils } from '@adguard/agtree';

/** Capabilities of this desktop Chromium MV3 extension, not those of uBlock Origin. */
const CHROMIUM_MV3_ENVIRONMENT: Readonly<Record<string, boolean>> = Object.freeze({
  env_mv3: true,
  env_chromium: true,
  env_firefox: false,
  env_safari: false,
  env_mobile: false,
  cap_html_filtering: false,
  cap_user_stylesheet: true,
  ext_ubol: false,
  ext_ublock: false,
  adguard: true,
  adguard_ext_chromium: true,
});

interface ConditionalFrame { parentActive: boolean; condition: boolean; elseSeen: boolean; line: number }
const MAX_NESTING = 32;

function failure(line: number, message: string): Error {
  return new Error(`Bộ tiền xử lý dòng ${line}: ${message}`);
}

/** Replace the first code point with a same-length comment prefix to retain UTF-16 rule offsets. */
function commentLine(line: string): string {
  if (!line) return line;
  const first = String.fromCodePoint(line.codePointAt(0)!);
  return `!${' '.repeat(first.length - 1)}${line.slice(first.length)}`;
}

/**
 * Evaluate directives before any rule conversion or trust checks. Inactive text
 * and directive markers become comments without changing line endings or offsets.
 * Includes and unknown capabilities are rejected rather than guessed or fetched.
 */
export function preprocessChromiumMV3(text: string): string {
  const parts = text.split(/(\r\n|\n|\r)/);
  const stack: ConditionalFrame[] = [];
  let active = true;
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index]!;
    const trimmed = line.trim();
    const lineNumber = index / 2 + 1;
    if (!trimmed.startsWith('!#')) {
      if (!active) parts[index] = commentLine(line);
      continue;
    }
    const directive = trimmed.match(/^!#[ \t]*([a-z_][a-z0-9_]*)(.*)$/i);
    if (!directive) throw failure(lineNumber, 'Chỉ thị điều kiện không hợp lệ.');
    const [, name, tail] = directive;
    const argument = tail!.trim();
    if (name === 'include') throw failure(lineNumber, 'Không cho phép danh sách tải thêm nguồn từ xa.');
    if (name === 'if') {
      if (stack.length >= MAX_NESTING) throw failure(lineNumber, `Tối đa ${MAX_NESTING} cấp điều kiện lồng nhau.`);
      if (!argument) throw failure(lineNumber, 'Điều kiện if bị thiếu.');
      let condition: boolean;
      try {
        const expression = LogicalExpressionParser.parse(argument, { isLocIncluded: false });
        for (const variable of LogicalExpressionUtils.getVariables(expression)) {
          if (!Object.hasOwn(CHROMIUM_MV3_ENVIRONMENT, variable.name)) throw new Error(`Biến môi trường không được hỗ trợ: ${variable.name}`);
        }
        condition = LogicalExpressionUtils.evaluate(expression, CHROMIUM_MV3_ENVIRONMENT);
      } catch (error) {
        throw failure(lineNumber, error instanceof Error ? error.message : String(error));
      }
      stack.push({ parentActive: active, condition, elseSeen: false, line: lineNumber });
      active = active && condition;
    } else if (name === 'else') {
      if (argument) throw failure(lineNumber, 'else không nhận tham số.');
      const frame = stack.at(-1);
      if (!frame) throw failure(lineNumber, 'else không có if tương ứng.');
      if (frame.elseSeen) throw failure(lineNumber, 'else bị lặp trong cùng điều kiện.');
      frame.elseSeen = true;
      active = frame.parentActive && !frame.condition;
    } else if (name === 'endif') {
      if (argument) throw failure(lineNumber, 'endif không nhận tham số.');
      const frame = stack.pop();
      if (!frame) throw failure(lineNumber, 'endif không có if tương ứng.');
      active = frame.parentActive;
    } else {
      throw failure(lineNumber, `Chỉ thị không được hỗ trợ: ${name}`);
    }
    const marker = line.indexOf('!#');
    parts[index] = `${line.slice(0, marker + 1)} ${line.slice(marker + 2)}`;
  }
  if (stack.length) throw failure(stack.at(-1)!.line, 'if chưa có endif tương ứng.');
  return parts.join('');
}
