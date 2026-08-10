// ====================================================================
// ads.js — Google AdSense 公共广告加载脚本
// --------------------------------------------------------------------
// 用法：
//   1. 页面中放置广告容器：<div data-ad-banner data-ad-format="auto" style="display:none;..."></div>
//   2. 页面引入本脚本：<script src="ads.js"></script>（子目录用 ../ads.js）
//   3. ads.js 自动完成：VIP 用户去广告 / 大陆用户静默跳过 / 延迟加载 adsbygoogle.js
// --------------------------------------------------------------------
// 上线前必改：
//   const CLIENT_ID  = 'ca-pub-XXXXXXXXXXXXXXXX';   // AdSense 发布商 ID
//   const DEFAULT_SLOT = 'XXXXXXXXXX';              // 广告单元 Slot ID
// ====================================================================

(function () {
  'use strict';

  // TODO: 替换为你的 AdSense 发布商 ID 与广告单元 Slot
  var CLIENT_ID = 'ca-pub-0000000000000000';
  var DEFAULT_SLOT = '0000000000';

  // 获取页面中的广告容器（DOM 就绪后再调用，避免 head 同步执行时找不到 body 元素）
  function getBanners() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-ad-banner]'));
  }

  // ---- VIP 付费用户去广告 ----
  function isVip() {
    try {
      return typeof Auth !== 'undefined' && Auth.isPaid && Auth.isPaid();
    } catch (e) { return false; }
  }

  // 认证模块是否已完成初始化（auth.js 中的 Auth._ready）
  function isAuthReady() {
    try { return typeof Auth === 'undefined' || Auth._ready === true; } catch (e) { return true; }
  }

  // ---- 大陆用户静默跳过（Google 在大陆被屏蔽）----
  function isMainlandChina() {
    return /^zh-?cn/i.test((navigator.language || '').toLowerCase());
  }

  // ---- 渲染所有广告单元 ----
  function renderAds(banners) {
    banners.forEach(function (banner) {
      if (banner.getAttribute('data-rendered')) return;
      var ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.setAttribute('data-ad-client', CLIENT_ID);
      ins.setAttribute('data-ad-slot', banner.getAttribute('data-ad-slot') || DEFAULT_SLOT);
      ins.setAttribute('data-ad-format', banner.getAttribute('data-ad-format') || 'auto');
      banner.appendChild(ins);
      banner.setAttribute('data-rendered', '1');
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
    });
  }

  // ---- 加载 adsbygoogle.js（延迟，避免拖慢仿真启动）----
  function loadAdScript(banners) {
    if (window.adsbygoogle) { renderAds(banners); return; }
    var s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + CLIENT_ID;
    s.onload = function () { renderAds(banners); };
    s.onerror = function () { /* 加载失败（如大陆网络）：保持隐藏，静默处理 */ };
    document.head.appendChild(s);
  }

  function showBanners(banners) {
    banners.forEach(function (banner) { banner.style.display = 'block'; });
    loadAdScript(banners);
  }

  // 等待认证初始化完成后再决定是否展示广告（保证 VIP 判断准确）
  var attempts = 0;
  function tryInit() {
    attempts++;

    var banners = getBanners();
    if (!banners.length) return;

    // 认证模块存在但尚未初始化时，主动调用 Auth.init() 以准确识别 VIP 用户
    if (attempts === 1 && typeof Auth !== 'undefined' && !Auth._ready && Auth.init) {
      try {
        Auth.init().then(function () {
          if (isVip()) return;                       // VIP：永不加载广告
          if (isMainlandChina()) return;             // 大陆：静默跳过
          showBanners(getBanners());
        });
        return;
      } catch (e) { /* 继续走兜底逻辑 */ }
    }

    if (isVip()) return;                              // VIP：永不加载广告
    if (!isAuthReady() && attempts < 30) {            // 认证未就绪则稍后重试（最长约9秒）
      setTimeout(tryInit, 300);
      return;
    }
    if (isMainlandChina()) return;                    // 大陆：静默跳过
    showBanners(banners);
  }

  // 页面空闲或加载完成后执行，避免拖慢仿真启动
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(function () { tryInit(); }, { timeout: 3000 });
  } else if (document.readyState === 'complete') {
    tryInit();
  } else {
    window.addEventListener('load', function () { setTimeout(tryInit, 500); });
  }
})();
