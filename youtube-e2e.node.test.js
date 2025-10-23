// youtube-e2e.node.test.js
// Run with: npm run test:e2e

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

test('YouTube E2E: Search and Result, Play/Pause, Seek/Skip, Screenshot, Check Title (node:test)', async (t) => {
  // --Config----
  const SEARCH_TERM = 'QA Automation';
  const videoSel = '#movie_player video.html5-main-video';
  const playerSel = '#movie_player';

  // Intervals 
  const PAUSE_HOLD_MS = 5000;          // stay paused so tester can see it
  const PLAY_BEFORE_SEEK_MS = 4000;    // play a bit before skipping
  const INTERVAL_AFTER_SEEK_MS = 5000; // wait before screenshot
  const SEEK_JUMP_SECONDS = 10;

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // --Page-side helpers--
  const js = {
    play: (sel) => {
      const v = document.querySelector(sel);
      if (v && v.paused) { v.muted = true; return v.play().catch(() => {}); }
    },
    pause: (sel) => {
      const v = document.querySelector(sel);
      if (v && !v.paused) v.pause();
    },
    state: (sel) => {
      const v = document.querySelector(sel);
      return v ? { paused: v.paused, readyState: v.readyState, time: v.currentTime, dur: v.duration || 0 } : null;
    }
  };

  // --Node-side helpers--
  async function ensurePlaying(sel) {
    const deadline = Date.now() + 25000;
    await page.evaluate(js.play, sel);
    let prev = (await page.evaluate(js.state, sel))?.time ?? 0;

    while (Date.now() < deadline) {
      await page.waitForTimeout(700);
      const st = await page.evaluate(js.state, sel);
      if (!st) return false;

      const delta = st.time - prev;
      if (!st.paused && st.readyState >= 3 && delta >= 0.3) {
        console.log(`Playback confirmed (Δ=${delta.toFixed(2)}s, readyState=${st.readyState}).`);
        return true;
      }
      if (st.paused) await page.evaluate(js.play, sel);
      prev = st.time;
    }
    return false;
  }

  async function skipAdsIfAny() {
    const player = page.locator('#movie_player');
    const skipSelectors = [
      '.ytp-ad-skip-button-modern',
      '.ytp-ad-skip-button',
      '.ytp-skip-ad-button',
      '.ytp-ad-skip-button-container .ytp-ad-skip-button'
    ];
    const adState = () => page.evaluate(() => {
      const p = document.getElementById('movie_player');
      return p ? (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')) : false;
    });

    const adDeadline = Date.now() + 15000; // 15s max
    while (Date.now() < adDeadline) {
      try {
        const box = await player.boundingBox();
        if (box) await page.mouse.move(box.x + box.width / 2, box.y + 40);
      } catch {}

      let clickedSkip = false;
      for (const sel of skipSelectors) {
        const btn = page.locator(sel);
        if (await btn.isVisible().catch(() => false)) {
          try { 
	   // give the button a bit more time to be interactable
	    await btn.click({ timeout: 300 }); 
	  } catch { 
	   // fallback to force-click if normal click fails
	    await btn.click({ timeout: 300, force: true }); 
	  }
          console.log(`Clicked Skip Ad via: ${sel}`);
          clickedSkip = true;
          break;
        }
      }
      if (clickedSkip) break;
      if (!(await adState())) break;
      await page.waitForTimeout(250);
    }
    // Wait until player exits ad state
    try {
      await page.waitForFunction(() => {
        const p = document.getElementById('movie_player');
        return p && !p.classList.contains('ad-showing') && !p.classList.contains('ad-interrupting');
      }, { timeout: 8000 });
    } catch {}
  }

  // Looking if the player currently showing an ad
  async function inAd() {
    return await page.evaluate(() => {
      const p = document.getElementById('movie_player');
      return !!(p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')));
    });
  }

  // Ensuring not currently in an ad and if metadata looks like the actual content
  async function ensureContentVideoReady(sel) {
    const deadline = Date.now() + 20000; // 20s
    while (Date.now() < deadline) {
      await skipAdsIfAny(); // attempt to clear any ad first

      const st = await page.evaluate((s) => {
        const v = document.querySelector(s);
        return v ? { rs: v.readyState, dur: Number.isFinite(v.duration) ? v.duration : Infinity } : null;
      }, sel);

      const adNow = await inAd();
      const metaOk = !!(st && st.rs >= 2);
      // Usually main content has duration >= 60s (Infinity allowed for live)
      const looksLikeContent = !!(st && (st.dur === Infinity || st.dur >= 60));

      if (!adNow && metaOk && looksLikeContent) return true;

      await page.waitForTimeout(300);
    }
    return false;
  }

  try {
    // Step 1: Go to YouTube & consent
    await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
    console.log('STEP 1 (/) Navigated to YouTube.');
    try {
      const consentBtn = page.locator(
        'button:has-text("Accept all"), button:has-text("I agree"), button:has-text("Agree"), ' +
        'tp-yt-paper-button:has-text("Accept all"), tp-yt-paper-button:has-text("I agree")'
      );
      if (await consentBtn.first().isVisible({ timeout: 4000 })) {
        await consentBtn.first().click();
        console.log('Consent banner accepted.');
      }
    } catch {}

    // Step 2: Search & open first non-ad video (click title to avoid inline preview)
    const search = page.locator('input#search, input[name="search_query"]');
    await search.first().waitFor({ state: 'visible', timeout: 20000 });
    await search.first().fill(SEARCH_TERM);
    console.log('STEP 2 → Search term filled.');
    await search.first().press('Enter');
    console.log('Pressed Enter key.');

    await page.waitForSelector('ytd-video-renderer', { timeout: 20000 });
    const items = page.locator('ytd-video-renderer');
    const n = await items.count();
    assert.ok(n > 0, 'Expected at least one search result.');
    console.log(`Found ${n} video results.`);

    let clicked = false;
    for (let i = 0; i < n; i++) {
      const item = items.nth(i);
      const isAd =
        (await item.locator('ytd-display-ad-renderer, ytd-ad-slot-renderer, .ytd-promoted-sparkles-web-renderer').count()) > 0;
      if (isAd) continue;

      const titleLink = item.locator('a#video-title');
      if (await titleLink.isVisible()) {
        await Promise.all([
          page.waitForURL(/\/watch\?v=/, { timeout: 30000 }),
          titleLink.click()
        ]);
        console.log(`Clicked title of non-ad video #${i + 1}.`);
        clicked = true;
        break;
      }
    }
    assert.ok(clicked, 'Failed to click a non-ad video result.');
    await page.waitForLoadState('domcontentloaded');
    console.log('STEP 2 (/) Opened watch page.');

    // Step 3: Ensure video element present
    const video = page.locator(videoSel);
    await video.first().waitFor({ state: 'attached', timeout: 20000 });
    console.log('STEP 3 (/) Video element attached.');

    // Step 4: Handle preroll ads
    await skipAdsIfAny();
    console.log('STEP 4 (/) Ad handling complete.');

    // Step 5: Ensure metadata & start playback
    await page.waitForFunction(
      (sel) => {
        const v = document.querySelector(sel);
        return v && v.readyState >= 2 && v.duration > 0;
      },
      videoSel,
      { timeout: 25000 }
    );
    console.log('Metadata loaded.');

    let started = await ensurePlaying(videoSel);
    assert.ok(started, 'Expected playback to start.');
    console.log('STEP 5 (/) Video playing.');

    // Guard 1: Ensure we are on actual content (not an ad) before pause
    const contentReady1 = await ensureContentVideoReady(videoSel);
    if (!contentReady1) console.log('Warning: Content not fully ready but proceeding.');
    // Make sure we’re playing again after any ad skip
    started = await ensurePlaying(videoSel);
    assert.ok(started, 'Expected playback to be active before pause.');

    // Let it play a bit for visibility
    await page.waitForTimeout(2000);

    // Step 6: Pause & hold, verify no progress while paused
    await page.evaluate(js.pause, videoSel);
    console.log('Paused. Verifying…');
    const pa1 = (await page.evaluate(js.state, videoSel))?.time ?? 0;
    await page.waitForTimeout(2000);
    const pa2 = (await page.evaluate(js.state, videoSel))?.time ?? 0;
    assert.ok(Math.abs(pa2 - pa1) < 0.5, 'Video should be paused (no time progress).');
    console.log('Pause verified (initial).');

    console.log(`Holding pause for ${PAUSE_HOLD_MS}ms to observe…`);
    await page.waitForTimeout(PAUSE_HOLD_MS);

    const pa3 = (await page.evaluate(js.state, videoSel))?.time ?? 0;
    assert.ok(Math.abs(pa3 - pa2) < 0.5, 'Video should still be paused after hold.');
    console.log('Pause still verified after hold.');

    // Step 7: Resume play for a bit, then seek forward
    console.log(`Resuming playback for ${PLAY_BEFORE_SEEK_MS}ms before seek…`);
    await page.evaluate(js.play, videoSel);

    // confirm re-playing
    {
      const deadline = Date.now() + 8000;
      let prev = (await page.evaluate(js.state, videoSel))?.time ?? 0;
      let ok = false;
      while (Date.now() < deadline) {
        await page.waitForTimeout(600);
        const st = await page.evaluate(js.state, videoSel);
        if (!st) break;
        const delta = st.time - prev;
        if (!st.paused && st.readyState >= 3 && delta >= 0.3) { ok = true; break; }
        if (st.paused) await page.evaluate(js.play, videoSel);
        prev = st.time;
      }
      assert.ok(ok, 'Expected playback to resume before seek.');
    }
    await page.waitForTimeout(PLAY_BEFORE_SEEK_MS);

    // Guard 2: Ensure we’re not in ad right before skipping
    const contentReady2 = await ensureContentVideoReady(videoSel);
    if (!contentReady2) console.log('Warning: Content not fully ready before seek.');
    await ensurePlaying(videoSel);

    const before = await page.evaluate(js.state, videoSel);
    console.log(`Before seek: t=${before.time.toFixed(2)}s / dur=${before.dur ? before.dur.toFixed(2) : '∞'}`);

    // Programmatic seek with 'seeked' event
    const targetAfterDirect = await page.evaluate(async ({ sel, jump }) => {
      const v = document.querySelector(sel);
      if (!v) return 0;
      const dur = Number.isFinite(v.duration) ? v.duration : Infinity;
      const target = dur !== Infinity ? Math.min(v.currentTime + jump, Math.max(dur - 1, 0)) : v.currentTime + jump;
      await new Promise((resolve) => {
        const done = () => { v.removeEventListener('seeked', done); resolve(); };
        v.addEventListener('seeked', done, { once: true });
        v.currentTime = target;
        setTimeout(done, 4000);
      });
      return v.currentTime;
    }, { sel: videoSel, jump: SEEK_JUMP_SECONDS });

    let advanced = targetAfterDirect > before.time + 5;

    // Fallback: Click progress bar at ~70%
    if (!advanced) {
      const bar = page.locator('.ytp-progress-bar');
      if (await bar.isVisible().catch(() => false)) {
        const box = await bar.boundingBox();
        if (box) {
          const clickX = box.x + box.width * 0.7;
          const clickY = box.y + box.height / 2;
          await page.mouse.click(clickX, clickY);
          await page.waitForTimeout(800);
        }
      }
    }

    const afterSeek = (await page.evaluate(js.state, videoSel))?.time ?? 0;
    console.log(`After seek: t=${afterSeek.toFixed(2)}s`);
    assert.ok(afterSeek > before.time + 5, 'Expected video time to advance by > 5s after seek.');
    console.log('STEP 7 (/) Seek verified (+≥5s).');

    console.log(`Waiting ${INTERVAL_AFTER_SEEK_MS}ms before screenshot…`);
    await page.waitForTimeout(INTERVAL_AFTER_SEEK_MS);

    // Guard 3: Ensure we’re not in ad right before screenshot
    const contentReady3 = await ensureContentVideoReady(videoSel);
    if (!contentReady3) console.log('Warning: Content not fully ready before screenshot.');
    await ensurePlaying(videoSel);
    await page.waitForTimeout(1200); // give a moment for a fresh frame

    // Step 8: Screenshot while playing
    const screenshotsDir = path.join(process.cwd(), 'screenshots');
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir);

    const fileName = `screenshot-${Date.now()}.png`;
    const filePath = path.join(screenshotsDir, fileName);

    await page.screenshot({ path: filePath }); // or: await page.locator('#movie_player').screenshot({ path: filePath });
    assert.ok(fs.existsSync(filePath), 'Expected screenshot file to exist.');
    console.log(`STEP 8 (/) Screenshot saved: ${filePath}`);

    // Step 9: Verify title is not empty
    const titleLocator = page.locator('h1.ytd-watch-metadata yt-formatted-string');
    await titleLocator.first().waitFor({ state: 'visible', timeout: 20000 });
    const titleText = (await titleLocator.innerText()).trim();
    console.log(`Title: "${titleText}"`);
    assert.ok(titleText.length > 0, 'Expected non-empty video title.');
    console.log('STEP 9 (/) Title verified (not empty).');

    console.log('ALL STEPS PASSED (node:test).');
  } finally {
    await context.close();
    await browser.close();
  }
});
