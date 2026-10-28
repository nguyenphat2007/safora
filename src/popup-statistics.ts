import { STAT_CATEGORIES, STAT_LABELS, statisticsView, type BlockingHistory, type StatCategory, type StatSelection } from './shared/statistics';

const number = new Intl.NumberFormat('vi-VN');
const weekday = new Intl.DateTimeFormat('vi-VN', { weekday: 'short' });
const fullDate = new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric' });
function element(id: string): HTMLElement { return document.getElementById(id)!; }
function svg(tag: string, attributes: Record<string, string>): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}
export function renderStatistics(history: BlockingHistory): void {
  const range = (element('statistics-range') as HTMLSelectElement).value === '30' ? 30 : 7;
  const raw = (element('statistics-category') as HTMLSelectElement).value;
  const selection: StatSelection = STAT_CATEGORIES.includes(raw as StatCategory) ? raw as StatCategory : 'all';
  const { points, counts, total } = statisticsView(history, range, selection);
  element('statistics-total').textContent = number.format(total);
  element('statistics-period').textContent = `lượt chặn trong ${range} ngày`;
  element('statistics-note').textContent = `Ghi nhận từ ${fullDate.format(history.startedAt)} · Theo bộ lọc khớp.`;
  element('statistics-empty').hidden = total > 0;
  const drawing = document.createDocumentFragment(), labels = document.createDocumentFragment();
  const maximum = Math.max(1, ...points.map(point => point.value || 0));
  const coordinates: string[] = [];
  const descriptions: string[] = [];
  const marks: SVGElement[] = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index], x = 18 + index * 288 / (range - 1);
    const date = new Date(`${point.date}T12:00:00`);
    if (range === 7 || index === 0 || index === range - 1 || index % 6 === 0) {
      drawing.append(svg('line', { x1: String(x), x2: String(x), y1: '10', y2: '126', class: 'chart-grid' }));
      const label = document.createElement('span');
      label.style.left = `${x / 324 * 100}%`;
      label.textContent = range === 7 ? weekday.format(date).replace('Thứ ', 'T') : `${date.getDate()}/${date.getMonth() + 1}`;
      labels.append(label);
    }
    descriptions.push(`${fullDate.format(date)}: ${point.value === null ? 'chưa thu thập' : number.format(point.value) + ' lượt chặn'}`);
    if (point.value === null) continue;
    const y = 126 - point.value / maximum * 108;
    coordinates.push(`${x},${y}`);
    const mark = svg('circle', { cx: String(x), cy: String(y), r: range === 7 ? '3' : '2', class: 'chart-point' });
    const title = svg('title', {}); title.textContent = descriptions.at(-1)!; mark.append(title); marks.push(mark);
  }
  drawing.append(svg('line', { x1: '18', x2: '306', y1: '126', y2: '126', class: 'chart-grid' }));
  if (coordinates.length) {
    const firstX = coordinates[0].split(',')[0], lastX = coordinates.at(-1)!.split(',')[0];
    drawing.append(svg('polygon', { points: `${firstX},126 ${coordinates.join(' ')} ${lastX},126`, class: 'chart-area' }));
    drawing.append(svg('polyline', { points: coordinates.join(' '), class: 'chart-line' }));
    drawing.append(...marks);
  }
  element('statistics-chart-description').textContent = descriptions.join('; ');
  element('statistics-chart-drawing').replaceChildren(drawing);
  element('statistics-chart-labels').replaceChildren(labels);
  const rows = document.createDocumentFragment();
  const categories = selection === 'all' ? [...STAT_CATEGORIES].sort((a, b) => counts[b] - counts[a]) : [selection];
  for (const category of categories) {
    const row = document.createElement('li'), label = document.createElement('span'), count = document.createElement('strong');
    label.textContent = STAT_LABELS[category]; count.textContent = number.format(counts[category]);
    row.append(label, count); rows.append(row);
  }
  element('statistics-breakdown').replaceChildren(rows);
}
