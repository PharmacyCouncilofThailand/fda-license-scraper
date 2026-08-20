const { searchDrugLocations, closeBrowser } = require('./src/scraper');
(async () => {
  const t = Date.now();
  try {
    const r = await searchDrugLocations({ keyword: 'ฟาสซิโน', province: 'เชียงใหม่', limit: 2 });
    console.log(JSON.stringify({ ...r, results: r.results.slice(0, 2) }, null, 2));
  } catch (e) {
    console.error('FAIL', e.code, e.message);
  } finally {
    console.log('elapsed(s)', ((Date.now() - t) / 1000).toFixed(1));
    await closeBrowser();
  }
})();
