import { RuleParser } from '@adguard/agtree/parser';
import { CosmeticRule, NetworkRule, FilterList } from '@adguard/tsurlfilter';
import type { RuleDiagnostic } from './types';
import { preprocessChromiumMV3 } from './filter-preprocessor.ts';

/** Prepare effective personal rules without changing the user's saved source. */
export function prepareUserRules(text: string, scriptletsEnabled: boolean): string {
  const active = preprocessChromiumMV3(normalizeLegacyRules(text));
  if (scriptletsEnabled) return active;
  const parts = active.split(/(\r\n|\n|\r)/);
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('[')) continue;
    // The syntax tree distinguishes actual scriptlets (including ABP aliases
    // and exceptions) from URLs and CSS that merely contain a scriptlet marker.
    if (RuleParser.parse(trimmed).type === 'ScriptletInjectionRule') {
      const first = String.fromCodePoint(line.codePointAt(0)!);
      parts[index] = `!${' '.repeat(first.length - 1)}${line.slice(first.length)}`;
    }
  }
  return parts.join('');
}

/** Validate with the same parsers used by the actual AdGuard engine. */
export function validateUserRules(text: string): RuleDiagnostic[] {
  if (text.length > 250000 || text.split(/\r\n|\n|\r/).length > 5000) return [{line:1,message:'Tối đa 250.000 ký tự / 5.000 dòng.'}];
  const errors: RuleDiagnostic[]=[];
  let active: string;
  try { active = prepareUserRules(text, true); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{ line: Number(message.match(/^Bộ tiền xử lý dòng (\d+):/)?.[1] || 1), message }];
  }
  active.split(/\r\n|\n|\r/).forEach((source,index)=>{
    const line=source.trim(); if(!line || line.startsWith('!') || line.startsWith('['))return;
    try {
      const node=RuleParser.parse(line);
      if(node.type==='InvalidRule') throw new Error('Cú pháp bộ lọc không hợp lệ.');
      if(node.category==='Network') new NetworkRule(line,0,index);
      if(node.category==='Cosmetic') {
        if(node.type==='JsInjectionRule') throw new Error('JavaScript tùy ý không được chạy. Hãy dùng scriptlet đóng gói sẵn.');
        const converted=new FilterList(line);
        if(converted.getConversionErrors().length)throw new Error(converted.getConversionErrors()[0].message);
        const rule=new CosmeticRule(converted.getContent().trim(),0,index);
        if(node.type==='ElementHidingRule' && !rule.isExtendedCss() && typeof CSS!=='undefined' && !CSS.supports(`selector(${node.body.selectorList.value})`)) throw new Error('CSS selector không được trình duyệt hỗ trợ.');
      }
    } catch(error) { errors.push({line:index+1,message:error instanceof Error?error.message:String(error)}); }
  });
  return errors;
}
export function normalizeLegacyRules(text:string):string {
  return text.replace(/^([^#\r\n]*)#\+js\(/gm,'$1##+js(');
}
