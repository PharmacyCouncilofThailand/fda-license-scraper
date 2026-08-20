'use strict';

const fs = require('fs');

/**
 * Puppeteer's bundled Chromium is preferred. When it was not downloaded
 * (offline install, corporate proxy), fall back to CHROME_PATH or a locally
 * installed Chrome/Edge.
 */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA &&
      `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

module.exports = {
  executablePath: findChrome(),
  port: Number(process.env.PORT || 3000),
  headless: process.env.HEADLESS !== 'false',
  navTimeoutMs: Number(process.env.NAV_TIMEOUT_MS || 45000),
  // Scrapes are cached per keyword (province filtering happens locally), so
  // changing only the province is instant.
  cacheTtlMs: Number(process.env.CACHE_TTL_MS || 30 * 60 * 1000),
  cacheMaxKeywords: Number(process.env.CACHE_MAX || 50),

  // Safety caps so a very broad keyword cannot run forever.
  maxPages: Number(process.env.MAX_PAGES || 60),
  maxDetails: Number(process.env.MAX_DETAILS || 25),

  // The site sits behind a GDCC WAF that returns HTTP 500 for the default
  // HeadlessChrome user agent, so a normal desktop UA is required.
  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',

  // Detail pop-up, built from a row's Newcode.
  detailUrlBase:
    'http://pertento.fda.moph.go.th/FDA_SEARCH_DRUG/SEARCH_DRUG/pop-up_drug_location_operator.aspx',

  targetUrl:
    'https://meshlog.fda.moph.go.th/SEARCH_CENTER_HERB/MAIN/SEARCH_CENTER_MAIN.aspx',

  selectors: {
    radioDrugLocation: '#ContentPlaceHolder1_R_LCN_DRUG',
    searchInput: '#ContentPlaceHolder1_txt_search',
    searchButton: '#ContentPlaceHolder1_btn_search',
    resultGrid: '#ContentPlaceHolder1_RAD_LCN_ctl00',
    pageSizeInput: '#ContentPlaceHolder1_RAD_LCN_ctl00_ctl03_ctl01_PageSizeComboBox_Input',
    pageSizeArrow: '#ContentPlaceHolder1_RAD_LCN_ctl00_ctl03_ctl01_PageSizeComboBox_Arrow',
    pageSizeDropDown: '#ContentPlaceHolder1_RAD_LCN_ctl00_ctl03_ctl01_PageSizeComboBox_DropDown',
    currentPage: '#ContentPlaceHolder1_RAD_LCN_ctl00 .rgCurrentPage',
    nextPage: '#ContentPlaceHolder1_RAD_LCN_ctl00 input.rgPageNext',
  },

  // Detail pop-up page (opens in a new tab / window).
  detailSelectors: {
    licenseNo: '#ContentPlaceHolder1_lb_fdpdtno_pop',
    licenseeName:
      '#ContentPlaceHolder1_UC_location_operator_licen_Datalist1_lb_licen_0',
    operatorName: '#ContentPlaceHolder1_lb_operation_nm',
    storeName: '#ContentPlaceHolder1_lb_store',
    openHours: '#ContentPlaceHolder1_lb_time_store',
    // "map :" link — a Google Maps search URL carrying the establishment's
    // coordinates. Missing or 0,0 for records the FDA never geocoded.
    mapLink: '#ContentPlaceHolder1_lnk_premix',
  },
};
