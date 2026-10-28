// Controlled structural fixtures from public HTML and runtime-source review.
// No publisher/ad scripts are executed. SDA/CAND slots start hidden in the
// source; these fixtures activate their reserved boxes to exercise hiding.
// Evidence, response hashes and exclusions: test-results/web-research-1.12/.
import { coverageFixtures, layoutVariants, renderCoverageFixture } from './web-coverage-fixtures.mjs';

export const GENERIC_SDA_SELECTOR = '.rennab[id^="sdaWeb_"][data-position^="Web_Sda"]';
export const GENERIC_SDA_RULE = `##${GENERIC_SDA_SELECTOR}`;
export const WEB_EXPANSION_RULES = Object.freeze([
  GENERIC_SDA_RULE,
  'cand.vn##.banner[id^="adsWeb_"][data-position^="Web_Ads"]',
  'baoxaydung.vn##aside[aria-label="Quảng cáo"]',
]);

const scaffold = coverageFixtures[0];
// Reuse the finite local interactions from the existing coverage fixture.
// Each layout's related-card ID is made unique before combining the layouts.
const ordinaryMain = scaffold.main + layoutVariants.slice(1).map(layout =>
  layout.main.replaceAll('id="ordinary-card"', `id="ordinary-${layout.kind}-card"`)).join('');
const ordinaryControls = [
  ...scaffold.controlSelectors,
  ...layoutVariants.slice(1).flatMap(layout => layout.controlSelectors.map(selector =>
    selector === '#ordinary-card' ? `#ordinary-${layout.kind}-card` : selector)),
];

const sdaControls = `
<div id="sdaWeb_Editorial" class="rennab fixture-component" data-position="ArticleWeb">Editorial position with a similar ID and class</div>
<div id="ordinary-sda-id" class="rennab fixture-component" data-position="Web_SdaEditorial">Non-ad ID with a similar class and position</div>
<div id="sdaWeb_OrdinaryClass" class="fixture-component" data-position="Web_SdaEditorial">Non-ad class with similar ID and position</div>
<div id="sdaWeb_MissingPosition" class="rennab fixture-component">Missing position attribute</div>`;
const sdaControlSelectors = ['#sdaWeb_Editorial', '#ordinary-sda-id', '#sdaWeb_OrdinaryClass', '#sdaWeb_MissingPosition'];
const sdaAds = '<div id="sdaWeb_SdaHomeRight1" class="rennab native-target" data-platform="1" data-position="Web_SdaHomeRight1" data-label="Activated SDA advertising slot" data-fixture-ad></div>';

function sdaFixture(host, kind, title, baselineHidden = false) {
  return {
    host, kind, title,
    scope: baselineHidden ? 'preserved-vietnam' : 'generic-sda',
    main: ordinaryMain + sdaControls, ads: sdaAds,
    rules: [GENERIC_SDA_RULE], positiveSelectors: ['#sdaWeb_SdaHomeRight1'],
    controlSelectors: [...ordinaryControls, ...sdaControlSelectors],
    baselineHidden, adsDisabledHidden: baselineHidden,
    genericHideExceptionHidden: baselineHidden, vietnamDisabledHidden: true,
    ...(baselineHidden ? { preservedScopedRule: `${host}##${GENERIC_SDA_SELECTOR}` } : {}),
    note: baselineHidden
      ? 'The unchanged Vietnam-specific rule already hides this slot. Disabling Ads or generic hiding leaves that scoped rule active; disabling Vietnam leaves the new Web generic rule active. Global/site bypass disables both.'
      : 'The exact three-marker framework signature is generic. Partial markers and ordinary controls remain visible. A generichide exception disables this target; the source slot was initially hidden and is activated only in the fixture.',
  };
}

const candControls = `
<div id="adsWeb_Editorial" class="banner fixture-component" data-position="ArticleWeb">Editorial banner position</div>
<div id="ordinary-cand-id" class="banner fixture-component" data-position="Web_AdsEditorial">Different ID prefix</div>
<div id="adsWeb_OrdinaryClass" class="fixture-component" data-position="Web_AdsEditorial">Different class</div>
<div id="adsWeb_MissingPosition" class="banner fixture-component">Missing position attribute</div>`;
const baoxaydungControls = `
<aside id="ordinary-related-aside" class="fixture-component" aria-label="Tin liên quan">Related editorial article</aside>
<aside id="ordinary-unlabelled-aside" class="fixture-component">Ordinary unlabelled sidebar</aside>
<div id="ordinary-labelled-div" class="fixture-component" aria-label="Quảng cáo">Same label on a different element type</div>
<aside id="ordinary-label-suffix" class="fixture-component" aria-label="Quảng cáo biên tập">Synthetic near-match label boundary</aside>`;

export const expansionFixtures = Object.freeze([
  sdaFixture('congluan.vn', 'congluan-news', 'Cong Luan exact SDA signature'),
  sdaFixture('sda.expansion.example.test', 'generic-sda', 'Unlisted host using the exact SDA framework signature'),
  {
    host: 'cand.vn', kind: 'cand-news', title: 'CAND scoped ad framework slots', scope: 'publisher',
    main: ordinaryMain + candControls,
    ads: '<div id="adsWeb_AdsHomeZone_1415" class="banner native-target" data-platform="1" data-position="Web_AdsHomeZone_1415" data-label="Activated CAND advertising slot" data-fixture-ad></div>',
    rules: [WEB_EXPANSION_RULES[1]], positiveSelectors: ['#adsWeb_AdsHomeZone_1415'],
    controlSelectors: [...ordinaryControls, '#adsWeb_Editorial', '#ordinary-cand-id', '#adsWeb_OrdinaryClass', '#adsWeb_MissingPosition'],
    baselineHidden: false, adsDisabledHidden: false, genericHideExceptionHidden: true, vietnamDisabledHidden: true,
    note: 'The publisher redirects cand.com.vn to cand.vn. Only the exact banner/ID/position conjunction on the current host is selected. The initially hidden source slot is activated locally; no live creative or account session is exercised.',
  },
  {
    host: 'baoxaydung.vn', kind: 'baoxaydung-news', title: 'Bao Xay Dung explicitly labelled ad-only asides', scope: 'publisher',
    main: ordinaryMain + baoxaydungControls,
    ads: '<aside id="target-labelled-aside" class="native-target" aria-label="Quảng cáo" data-label="Reserved labelled ad slot" data-fixture-ad><div id="pos-1"></div></aside><aside id="target-labelled-zone" class="adscode native-target" aria-label="Quảng cáo" data-label="Reserved labelled ad zone" data-fixture-ad><zone id="mu3qubso"></zone></aside>',
    rules: [WEB_EXPANSION_RULES[2]], positiveSelectors: ['#target-labelled-aside', '#target-labelled-zone'],
    controlSelectors: [...ordinaryControls, '#ordinary-related-aside', '#ordinary-unlabelled-aside', '#ordinary-labelled-div', '#ordinary-label-suffix'],
    baselineHidden: false, adsDisabledHidden: false, genericHideExceptionHidden: true, vietnamDisabledHidden: true,
    note: 'All seven observed asides with this exact accessible label contain only an empty pos-* DIV or ad zone; articles are outside them. The fixture represents both shapes without loading advertising.',
  },
  sdaFixture('tienphong.vn', 'preserved-vietnam-sda', 'Existing Vietnam-scoped SDA rule remains independent', true),
]);

export function renderExpansionFixture(fixture, { includeAds = true } = {}) {
  if (!expansionFixtures.includes(fixture)) throw new Error('Unknown expansion fixture');
  // Invoke the original renderer with its own known object. The extension of
  // the document is fixture composition, not a bypass of its identity guard.
  return renderCoverageFixture(scaffold, { includeAds: false })
    .replace(`<title>${scaffold.title}</title>`, `<title>${fixture.title}</title>`)
    .replace(scaffold.main, fixture.main)
    .replace('</main>', `</main>${includeAds ? fixture.ads : ''}`);
}
