// Controlled structural fixtures, not real publisher/ad scripts or an AMP-runtime test.
// AMP primary docs: https://amp.dev/documentation/components/amp-sticky-ad/
// https://amp.dev/documentation/components/amp-ad (amp-embed aliases amp-ad).
// Observed 2026-10-25. Generic cases exercise component semantics across layouts;
// they do not prove that every sampled publisher currently deploys AMP advertising.
// Lowyat public HTML: https://forum.lowyat.net/ (187,931 decoded bytes), SHA-256
// 13843758ff5077506cfa463a093f7ef993e9c708382ece523c5d3961c92dab6a.
// Its GPT defineSlot('/1101362/LYNBillboard', ..., 'LYNBillboard') maps to a
// 250px-high DIV containing only googletag.display. No real GPT code runs here.

export const WEB_COVERAGE_RULES = Object.freeze([
  '##amp-sticky-ad',
  '##amp-embed[type="adsense"]',
  '##amp-embed[type="doubleclick"]',
  'forum.lowyat.net###LYNBillboard',
]);

export const layoutVariants = Object.freeze([
  {
    kind: 'news', host: 'news.coverage.example.test', title: 'Ordinary news',
    main: '<article id="ordinary-article"><h2>Editorial headline</h2><p>Ordinary article text.</p><div id="ordinary-card" class="fixture-story-card">Related editorial story</div></article>',
    controlSelectors: ['#ordinary-article', '#ordinary-card'],
  },
  {
    kind: 'forum', host: 'forum.coverage.example.test', title: 'Ordinary discussion',
    main: '<section id="ordinary-thread"><h2>Discussion thread</h2><div id="ordinary-card" class="fixture-thread-card">Member reply</div><form id="reply-form"><label>Reply<input name="reply" value="Controlled reply"></label><button>Post reply</button></form><output id="reply-result">Not submitted</output></section>',
    controlSelectors: ['#ordinary-thread', '#ordinary-card', '#reply-form'],
  },
  {
    kind: 'shop', host: 'shop.coverage.example.test', title: 'Ordinary shop',
    main: '<section id="ordinary-product"><h2>Ordinary product</h2><div id="ordinary-card" class="fixture-product-card">Product details</div><button id="buy">Add to cart</button><output id="cart-result">0</output><section id="ordinary-payment"><form id="checkout"><label>Delivery<input name="delivery" value="Fixture address"></label><button>Confirm local order</button></form><output id="checkout-result">Not submitted</output></section></section>',
    controlSelectors: ['#ordinary-product', '#ordinary-card', '#buy', '#ordinary-payment', '#checkout'],
  },
  {
    kind: 'social', host: 'social.coverage.example.test', title: 'Ordinary social feed',
    main: '<section id="ordinary-login"><form id="login-form"><label>Display name<input name="name" value="Fixture user"></label><button>Continue locally</button></form><output id="login-result">Not submitted</output></section><article id="ordinary-card" class="fixture-social-card"><h2>Friend update</h2><p>Ordinary social content.</p></article>',
    controlSelectors: ['#ordinary-login', '#login-form', '#ordinary-card'],
  },
  {
    kind: 'video', host: 'video.coverage.example.test', title: 'Ordinary media',
    main: '<section id="ordinary-player"><h2>Local native media playback</h2><video id="ordinary-media" controls muted playsinline aria-label="Controlled local media"></video><button id="play-media">Play local media</button><output id="media-result">Not started</output></section><article id="ordinary-card" class="fixture-related-card">Related content</article>',
    controlSelectors: ['#ordinary-player', '#ordinary-media', '#play-media', '#ordinary-card'],
  },
]);

const genericAds = '<amp-sticky-ad id="target-sticky" class="native-target" layout="nodisplay" data-label="Activated sticky ad wrapper" data-fixture-ad><amp-ad type="doubleclick" width="320" height="50"></amp-ad></amp-sticky-ad><amp-embed id="target-adsense" class="native-target" type="adsense" width="300" height="250" data-label="Activated AdSense embed" data-fixture-ad></amp-embed><amp-embed id="target-doubleclick" class="native-target" type="doubleclick" width="300" height="250" data-label="Activated DoubleClick embed" data-fixture-ad></amp-embed>';
// Unknown provider values below are synthetic selector-boundary controls, not
// claims of supported real AMP providers or ordinary deployed amp-embed content.
const componentControls = '<amp-embed id="ordinary-embed" class="fixture-component" type="fixture-editorial">Synthetic unselected provider</amp-embed><amp-embed id="ordinary-embed-prefix" class="fixture-component" type="adsense-editorial">Synthetic provider near-match</amp-embed><amp-iframe id="ordinary-amp-frame" class="fixture-component" width="300" height="50">Ordinary iframe component</amp-iframe><amp-video id="ordinary-amp-video" class="fixture-component" width="300" height="50">Ordinary video component</amp-video><div id="ordinary-amp-lookalike" class="amp-sticky-ad-editorial">Ordinary similarly named class</div>';
const commonControls = ['#ordinary', '#ordinary-nav', '#ordinary-hero', '#ordinary-banner', '#ordinary-image', '#ordinary-embed', '#ordinary-embed-prefix', '#ordinary-amp-frame', '#ordinary-amp-video', '#ordinary-amp-lookalike'];

export const coverageFixtures = Object.freeze([
  ...layoutVariants.map(layout => ({
    ...layout, rules: WEB_COVERAGE_RULES.slice(0, 3), ads: genericAds,
    positiveSelectors: ['#target-sticky', '#target-adsense', '#target-doubleclick'],
    controlSelectors: [...commonControls, ...layout.controlSelectors],
    note: 'Activated structural AMP fixtures on an ordinary layout; no live AMP runtime or ad creative. The sticky wrapper keeps reserved space even if Base already hides its amp-ad child.',
  })),
  {
    ...layoutVariants[1], kind: 'lowyat-forum', host: 'forum.lowyat.net', title: 'Lowyat reserved ad space',
    rules: [WEB_COVERAGE_RULES[3]], positiveSelectors: ['#LYNBillboard'],
    ads: '<div id="LYNBillboard" class="native-target" style="height:250px;width:100%;max-width:1170px" data-label="Controlled reserved GPT ad space" data-fixture-ad></div>',
    main: `${layoutVariants[1].main}<nav id="navstrip">Forum breadcrumb</nav><section id="borderwrap">Ordinary category content</section><div id="LYNBillboard-info">Similar ID with ordinary content</div><div id="lmg-rail-wrap">Editorial headlines are outside the ad rule</div>`,
    controlSelectors: [...commonControls, ...layoutVariants[1].controlSelectors, '#navstrip', '#borderwrap', '#LYNBillboard-info', '#lmg-rail-wrap'],
    note: 'The publisher already loads GPT, which Base blocks. This fixture measures collapse of the separately reserved 250px ad container, not another newly blocked network request.',
  },
]);

// Only fixture interactions run. Finite 1.5s PCM WAV generation proves native
// media clock progression without an external server, codec download or stream.
export const coverageClientScript = `
window.coverageState={ready:true,formSubmitted:false,replySubmitted:false,cartCount:0,loginSubmitted:false,playing:false,mediaTime:0};
for(const [id,field,result] of [['checkout','formSubmitted','checkout-result'],['login-form','loginSubmitted','login-result'],['reply-form','replySubmitted','reply-result']]){
 document.getElementById(id)?.addEventListener('submit',event=>{event.preventDefault();window.coverageState[field]=true;document.getElementById(result).textContent='Submitted locally';});
}
document.getElementById('buy')?.addEventListener('click',()=>{document.getElementById('cart-result').textContent=String(++window.coverageState.cartCount);});
document.getElementById('play-media')?.addEventListener('click',async()=>{
 const media=document.getElementById('ordinary-media');
 try{
  if(!media.src){
   const count=12000,buffer=new ArrayBuffer(44+count),view=new DataView(buffer);
   const text=(at,value)=>{for(let i=0;i<value.length;i++)view.setUint8(at+i,value.charCodeAt(i));};
   text(0,'RIFF');view.setUint32(4,36+count,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,8000,true);view.setUint16(32,1,true);view.setUint16(34,8,true);text(36,'data');view.setUint32(40,count,true);
   new Uint8Array(buffer,44).fill(128);media.src=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));
   media.addEventListener('timeupdate',()=>{window.coverageState.mediaTime=media.currentTime;});
   media.addEventListener('ended',()=>{URL.revokeObjectURL(media.src);});
  }
  await media.play();window.coverageState.playing=true;document.getElementById('media-result').textContent='Playing local media';
 }catch(error){window.coverageState.mediaError=error.message;document.getElementById('media-result').textContent='Playback failed';}
});
`;

export function renderCoverageFixture(fixture, { includeAds = true } = {}) {
  if (!coverageFixtures.includes(fixture)) throw new Error('Unknown coverage fixture');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${fixture.title}</title><style>
body{font:16px system-ui;margin:20px;max-width:1000px}nav,section,article,form{margin:8px 0}main{display:block;min-height:30px}.native-target{display:block;min-height:64px;border:1px solid #b00;margin:8px 0}.native-target::before{content:attr(data-label)}.fixture-component{display:block;min-height:24px}video{width:320px;height:90px;background:#222}#ordinary-hero,#ordinary-banner{min-height:28px;background:#eee}
</style></head><body><nav id="ordinary-nav"><a href="#ordinary">Ordinary navigation</a></nav><header id="ordinary-hero" class="fixture-hero-banner">Editorial hero</header><div id="ordinary-banner" class="fixture-editorial-banner">Ordinary site announcement</div><main id="ordinary">${fixture.main}</main><img id="ordinary-image" alt="Ordinary illustration" width="20" height="20" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='20' height='20' fill='green'/%3E%3C/svg%3E">${componentControls}${includeAds ? fixture.ads : ''}<script>${coverageClientScript}</script></body></html>`;
}
