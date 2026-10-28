import '@adguard/tswebextension/mv3/content-script';
import { request } from './shared/api';
import type { ContentConfig } from './shared/types';
const ownerAttribute='data-rea-privacy-owned';
const host=location.hostname.toLowerCase();
let configuration:ContentConfig={enabled:false};
let stopPicker:(()=>void)|undefined;
const pickedStyles=new Set<HTMLStyleElement>();
let refreshing:Promise<void>|undefined;
let refreshAgain=false;
function owned(element:Element):boolean{return element.hasAttribute(ownerAttribute)||!!element.closest(`[${ownerAttribute}]`);}
function clearOwnedElements():void{
  stopPicker?.();
  for(const style of pickedStyles)style.remove();
  pickedStyles.clear();
}
function refresh():Promise<void>{
  if(refreshing){refreshAgain=true;return refreshing;}
  refreshing=(async()=>{
    do{
      refreshAgain=false;
      try{
        configuration=await request<ContentConfig>({type:'contentConfig'});
        if(!configuration.enabled)clearOwnedElements();
      }catch(error){configuration={enabled:false};clearOwnedElements();throw error;}
    }while(refreshAgain);
  })().finally(()=>{refreshing=undefined;});
  return refreshing;
}
function uniqueSelector(element: Element): string {
  const unique = (selector: string): boolean => { try { return document.querySelectorAll(selector).length === 1; } catch { return false; } };
  if (element.id && !/^\d|\d{6,}/.test(element.id)) {
    const id = `#${CSS.escape(element.id)}`;
    if (unique(id)) return id;
  }
  const parts: string[] = [];
  let current: Element | null = element;
  for (let depth = 0; current && current !== document.documentElement && depth < 24; depth += 1, current = current.parentElement) {
    let part = current.localName;
    const classes = Array.from(current.classList).filter(name => !/\d{5,}|^(active|hover|selected|focus)$/i.test(name)).slice(0, 3);
    if (classes.length) part += classes.map(name => `.${CSS.escape(name)}`).join('');
    const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(sibling => sibling.localName === current?.localName) : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    parts.unshift(part);
    const selector = parts.join(' > ');
    if (unique(selector)) return selector;
  }
  throw new Error('Không tạo được bộ chọn duy nhất. Hãy chọn một phần tử nhỏ hơn.');
}

function startPicker(): void {
  if (window !== window.top) throw new Error('Hãy chọn phần tử trong khung trang chính.');
  if (!configuration.enabled) throw new Error('Hãy bật bảo vệ trước khi chặn phần tử.');
  if (!document.documentElement) throw new Error('Trang chưa sẵn sàng. Hãy thử lại.');
  stopPicker?.();
  const container = document.createElement('div');
  container.setAttribute(ownerAttribute, 'picker');
  container.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important';
  container.dataset.testid = 'element-picker';
  const shadow = container.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{color-scheme:dark}*{box-sizing:border-box}.mark{position:fixed;border:2px solid #dc354b;background:#dc354b30;pointer-events:none;border-radius:3px}
    .panel{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);width:min(440px,calc(100vw - 32px));padding:20px;border:1px solid #645158;border-radius:16px;background:#211b1e;color:#f6edf0;box-shadow:0 12px 60px #0008;font:14px/1.5 system-ui,sans-serif;pointer-events:auto}
    h2{font-size:18px;margin:0 0 8px}p{margin:8px 0;color:#d0c1c7}input{width:100%;padding:10px;background:#181315;border:1px solid #8f7681;border-radius:8px;color:#fff;font:13px monospace}button{border:0;border-radius:8px;padding:10px 16px;font:600 14px system-ui;cursor:pointer;background:#dc354b;color:#fff}button.cancel{background:#44363d;color:#fff}button:focus-visible,input:focus-visible{outline:3px solid #ff9ca9;outline-offset:3px}button:not(.cancel):hover{background:#bd283d}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}.error{color:#ffc38a}[hidden]{display:none!important}
  </style><div class="mark" hidden></div><section class="panel" role="dialog" aria-modal="true" aria-label="Chặn phần tử"><h2>Chọn phần tử cần chặn</h2><p class="instruction">Di chuột để xem vùng chọn, bấm để xem trước. Nhấn Esc để thoát.</p><label hidden>Bộ chọn CSS<input aria-label="Bộ chọn CSS" maxlength="1000"></label><p class="preview" aria-live="polite"></p><p class="error" role="alert"></p><div class="actions"><button class="cancel" type="button">Hủy</button><button class="save" type="button" hidden>Chặn phần tử</button></div></section>`;
  const mark = shadow.querySelector<HTMLDivElement>('.mark')!;
  const panel = shadow.querySelector<HTMLElement>('.panel')!;
  const input = shadow.querySelector<HTMLInputElement>('input')!;
  const label = shadow.querySelector<HTMLLabelElement>('label')!;
  const preview = shadow.querySelector<HTMLElement>('.preview')!;
  const error = shadow.querySelector<HTMLElement>('.error')!;
  const save = shadow.querySelector<HTMLButtonElement>('.save')!;
  const cancel = shadow.querySelector<HTMLButtonElement>('.cancel')!;
  let selected: Element | undefined;
  let confirming = false;
  let closed = false;
  let animationFrame: number | undefined;
  let pointer: { x: number; y: number } | undefined;
  const previousFocus = document.activeElement;
  document.documentElement.append(container);

  function highlight(element: Element): void {
    const rect = element.getBoundingClientRect();
    mark.hidden = false;
    mark.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
  }
  function move(event: MouseEvent): void {
    if (confirming || event.composedPath().includes(container)) return;
    pointer = { x: event.clientX, y: event.clientY };
    scheduleHighlight();
  }
  function updateHighlight(): void {
    animationFrame = undefined;
    if (closed) return;
    if (confirming || !pointer) {
      if (selected?.isConnected) highlight(selected);
      else { selected = undefined; mark.hidden = true; }
      return;
    }
    const target = document.elementFromPoint(pointer.x, pointer.y);
    if (!target || owned(target) || target === document.documentElement || target === document.body) { selected = undefined; mark.hidden = true; return; }
    selected = target; highlight(target);
  }
  function scheduleHighlight(): void {
    if (!closed && animationFrame === undefined) animationFrame = requestAnimationFrame(updateHighlight);
  }
  function click(event: MouseEvent): void {
    if (event.composedPath().includes(container)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (confirming) return;
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    pointer = { x: event.clientX, y: event.clientY };
    updateHighlight();
    if (!selected) return;
    try {
      input.value = uniqueSelector(selected);
      confirming = true; label.hidden = false; save.hidden = false;
      shadow.querySelector<HTMLElement>('.instruction')!.textContent = 'Kiểm tra bộ chọn rồi lưu. Quy tắc chỉ áp dụng cho tên miền này.';
      updatePreview(); input.focus();
    } catch (reason) { error.textContent = reason instanceof Error ? reason.message : String(reason); }
  }
  function updatePreview(): void {
    error.textContent = '';
    try {
      const selector = input.value.trim();
      if (!selector || selector.length > 1000 || selector.includes('##') || selector.includes('\n') || /[{}]/.test(selector)) throw new Error('Bộ chọn CSS không hợp lệ.');
      const matches = Array.from(document.querySelectorAll(selector)).filter(element => !owned(element));
      if (!matches.length || matches.some(element => element === document.documentElement || element === document.body)) throw new Error('Hãy chọn vùng nhỏ hơn, không chặn toàn bộ trang.');
      preview.textContent = `${host} · ${matches.length} phần tử sẽ bị ẩn`;
      save.disabled = false;
      selected = matches[0]; highlight(selected);
    } catch (reason) { preview.textContent = ''; error.textContent = reason instanceof Error ? reason.message : String(reason); save.disabled = true; }
  }
  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cleanup(); }
    else if (event.key === 'Tab') {
      const focusable = confirming ? [input, cancel, save].filter(element => !element.hidden && !element.disabled) : [cancel];
      const current = focusable.indexOf(shadow.activeElement as HTMLInputElement | HTMLButtonElement);
      event.preventDefault(); focusable[(current + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length].focus();
    }
  }
  function cleanup(): void {
    if (closed) return;
    closed = true;
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    animationFrame = undefined; pointer = undefined; selected = undefined;
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('click', click, true);
    window.removeEventListener('keydown', keydown, true);
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition, true);
    container.remove(); stopPicker = undefined;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  }
  function reposition(): void { scheduleHighlight(); }
  cancel.addEventListener('click', cleanup);
  input.addEventListener('input', updatePreview);
  save.addEventListener('click', () => {
    updatePreview();
    if (save.disabled) return;
    const selector = input.value.trim();
    save.disabled = true;
    void request({ type: 'addUserRule', rule: `${host}##${selector}` }).then(async () => {
      await refresh();
      if(closed||!configuration.enabled)return;
      const style=document.createElement('style');style.setAttribute(ownerAttribute,'picked-rule');style.textContent=`${selector}{display:none!important}`;document.documentElement.append(style);pickedStyles.add(style);cleanup();
    }).catch(reason => { error.textContent = reason instanceof Error ? reason.message : String(reason); save.disabled = false; });
  });
  window.addEventListener('mousemove', move, true);
  window.addEventListener('click', click, true);
  window.addEventListener('keydown', keydown, true);
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition, true);
  stopPicker = cleanup;
  panel.querySelector<HTMLButtonElement>('.cancel')?.focus({ preventScroll: true });
}

if (window === window.top) {
  chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
    if (message?.type === 'picker:start') {
      void refresh().then(()=>{startPicker();sendResponse({ok:true});}).catch(reason=>{sendResponse({ok:false,error:reason instanceof Error?reason.message:String(reason)});});
      return true;
    } else if (message?.type === 'config:refresh' && (refreshing||stopPicker||pickedStyles.size)) {
      void refresh().catch(()=>{/* Extension reload invalidates existing document contexts. */});
    }
  });
}
