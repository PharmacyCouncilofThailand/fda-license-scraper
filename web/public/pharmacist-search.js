/**
 * <pharmacist-search> — look a pharmacist's ภ. licence number up by name.
 *
 * Plain custom element on purpose: it is used by the React search page and by
 * form.html, which has no build step and is loaded by Puppeteer on every PDF
 * render. One implementation, no framework in the print path.
 *
 * No shadow DOM either, so it inherits the design tokens and control styles
 * from theme.css, which both pages already load.
 */
(() => {
  'use strict';

  // Same rule as web/src/api.js: same origin in production and through Vite's
  // proxy in development; the fallback is only for opening the file off disk.
  const BASE = location.protocol.startsWith('http') ? '' : 'http://localhost:3000';

  const GROUP_LABELS = {
    both: 'ตรงทั้งชื่อและนามสกุล',
    firstName: 'ตรงเฉพาะชื่อ',
    lastName: 'ตรงเฉพาะนามสกุล',
  };

  /**
   * `navigator.clipboard` exists only in a secure context, and the office
   * opens this over plain http on a LAN address — so keep the old selection
   * trick as the fallback rather than leaving the button dead there.
   */
  async function copy(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const scratch = document.createElement('textarea');
    scratch.value = value;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.append(scratch);
    scratch.select();
    const ok = document.execCommand('copy');
    scratch.remove();
    if (!ok) throw new Error('copy rejected');
  }

  /*
   * The FDA writes a pharmacist as one string with the title run into the
   * first name — "นางสาวกุลนิดา บูรณ์สิริจรุงรัฐ" — while the council searches
   * first name and surname separately. Longest titles first, so นางสาว is not
   * read as นาง with a stray สาว left on the front of the name.
   */
  const TITLES = [
    'เภสัชกรหญิง',
    'เภสัชกร',
    'ว่าที่ร้อยตรีหญิง',
    'ว่าที่ร้อยตรี',
    'นางสาว',
    'นาง',
    'นาย',
    'ภญ.',
    'ภก.',
    'ดร.',
    'ผศ.',
    'รศ.',
    'ศ.',
  ].sort((a, b) => b.length - a.length);

  function splitThaiName(full) {
    let rest = String(full || '').trim().replace(/\s+/g, ' ');
    for (const title of TITLES) {
      if (rest.startsWith(title)) {
        rest = rest.slice(title.length).trim();
        break;
      }
    }
    const space = rest.indexOf(' ');
    return space === -1
      ? { firstName: rest, lastName: '' }
      : { firstName: rest.slice(0, space), lastName: rest.slice(space + 1).trim() };
  }

  const el = (tag, className, textContent) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined) node.textContent = textContent;
    return node;
  };

  class PharmacistSearch extends HTMLElement {
    connectedCallback() {
      if (this.dataset.ready) return; // React may re-attach the same node
      this.dataset.ready = '1';
      this.controller = null;
      this.render();
      /*
       * The result preview offers "ค้นเลข ภ." beside each pharmacist it lists.
       * It announces the name on the document rather than reaching for this
       * element, so the two need no reference to each other — and the same
       * event works from React and from a plain page alike.
       */
      this.onFill = (event) => this.fill(event.detail && event.detail.name);
      document.addEventListener('pharmacist-search:fill', this.onFill);
    }

    disconnectedCallback() {
      if (this.controller) this.controller.abort();
      document.removeEventListener('pharmacist-search:fill', this.onFill);
    }

    /** Take a pharmacist's full name, split it into the two fields, and search. */
    fill(name) {
      const { firstName, lastName } = splitThaiName(name);
      if (!firstName && !lastName) return;
      this.first.value = firstName;
      this.last.value = lastName;
      this.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      this.search();
    }

    render() {
      this.innerHTML = '';
      const form = el('form', 'ps-form');
      form.noValidate = true;

      this.first = el('input', 'ps-input');
      this.first.placeholder = 'ชื่อ';
      this.first.autocomplete = 'off';
      this.last = el('input', 'ps-input');
      this.last.placeholder = 'นามสกุล';
      this.last.autocomplete = 'off';

      // Either field alone is a valid search, so both sit on one line and the
      // button below spans them — nothing suggests one is the required one.
      const fields = el('div', 'ps-fields');
      fields.append(this.first, this.last);

      this.submit = el('button', 'ps-submit', 'ค้นหา');
      this.submit.type = 'submit';
      this.clear = el('button', 'ps-clear', 'ล้าง');
      this.clear.type = 'button';
      this.clear.hidden = true;
      this.clear.addEventListener('click', () => this.reset());

      const actions = el('div', 'ps-actions');
      actions.append(this.submit, this.clear);

      form.append(el('span', 'ps-title', 'ค้นเลข ภ.'), fields, actions);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.search();
      });

      this.output = el('div', 'ps-output');
      this.append(form, this.output);
    }

    reset() {
      if (this.controller) this.controller.abort();
      this.first.value = '';
      this.last.value = '';
      this.output.innerHTML = '';
      this.clear.hidden = true;
      this.first.focus();
    }

    /** The button is the progress indicator, and locks while a search runs. */
    busy(on) {
      this.submit.disabled = on;
      this.submit.textContent = on ? 'กำลังค้น…' : 'ค้นหา';
    }

    /** One line of status text, replacing whatever is in the panel. */
    say(message, className) {
      this.output.innerHTML = '';
      this.output.append(el('p', `ps-note ${className || ''}`.trim(), message));
    }

    async search() {
      const firstName = this.first.value.trim();
      const lastName = this.last.value.trim();
      if (!firstName && !lastName) {
        this.say('กรุณากรอกชื่อหรือนามสกุลอย่างน้อยหนึ่งช่อง', 'ps-error');
        return;
      }

      if (this.controller) this.controller.abort();
      this.controller = new AbortController();
      this.clear.hidden = false;
      this.busy(true);
      this.say('กำลังค้นหา…');

      const query = new URLSearchParams({ firstName, lastName });
      try {
        const response = await fetch(`${BASE}/api/pharmacist?${query}`, {
          signal: this.controller.signal,
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.message || 'ค้นหาไม่สำเร็จ');
        }
        this.sourceUrl = data.sourceUrl;
        this.show(data);
      } catch (err) {
        if (err.name === 'AbortError') return;
        this.say(err.message, 'ps-error');
      } finally {
        this.busy(false);
      }
    }

    /**
     * Open one pharmacist's record on the council's own site. Their register
     * answers a POST and nothing else — a GET with the same parameters renders
     * an empty result — so this submits a real form into a new tab rather than
     * linking. Searching by licence number is the fuller view: it carries the
     * contact address and the photo, which the name search does not return.
     */
    openSource(licenseNo) {
      const form = el('form');
      form.method = 'post';
      form.action = this.sourceUrl;
      form.target = '_blank';
      form.hidden = true;
      for (const [name, value] of [
        ['txtfind_type', '1'],
        ['txtfind_id', licenseNo],
      ]) {
        const field = document.createElement('input');
        field.type = 'hidden';
        field.name = name;
        field.value = value;
        form.append(field);
      }
      document.body.append(form);
      form.submit();
      form.remove();
    }

    show(data) {
      const order = ['both', 'firstName', 'lastName'];
      const filled = order.filter((name) => data.groups[name].length > 0);
      if (filled.length === 0) {
        this.say('ไม่พบรายชื่อ — ต้องสะกดชื่อและนามสกุลให้ตรงทุกตัวอักษร');
        return;
      }

      this.output.innerHTML = '';
      // One filled group means one search term: no point labelling it.
      const single = filled.length === 1 && !(data.query.firstName && data.query.lastName);
      if (single) {
        this.output.append(el('p', 'ps-note', `พบ ${data.counts[filled[0]]} รายชื่อ`));
      }
      for (const name of filled) {
        this.output.append(
          this.group(name, data.groups[name], data.counts[name], single, name === 'both')
        );
      }
    }

    /** A `<details>` block, open when it holds the row the user is after. */
    group(name, rows, total, single, open) {
      const box = el('details', 'ps-group');
      box.open = single || open;
      if (!single) {
        box.append(el('summary', 'ps-summary', `${GROUP_LABELS[name]} (${total})`));
      }
      for (const row of rows) box.append(this.card(row));
      if (total > rows.length) {
        box.append(
          el(
            'p',
            'ps-note',
            `แสดง ${rows.length} จาก ${total} รายการ — ระบุอีกช่องเพื่อจำกัดผล`
          )
        );
      }
      return box;
    }

    /*
     * The name and the licence number are what the inspector came for and what
     * gets written onto the record, so they lead the card at full size. Status,
     * expiry and the council's notes are context and sit below, quieter.
     */
    card(row) {
      const card = el('div', 'ps-card');
      card.append(el('div', 'ps-name', row.fullName));

      const licence = el('div', 'ps-licence');
      licence.append(el('span', 'ps-licence-label', 'ภ.'));
      licence.append(el('span', 'ps-licence-no', row.licenseNo));
      card.append(licence);

      const actions = el('div', 'ps-card-actions');

      const button = el('button', 'ps-copy', 'คัดลอก');
      button.type = 'button';
      button.addEventListener('click', async () => {
        try {
          await copy(row.licenseNo);
          button.textContent = 'คัดลอกแล้ว';
        } catch {
          button.textContent = 'คัดลอกไม่ได้';
        }
        setTimeout(() => {
          button.textContent = 'คัดลอก';
        }, 1500);
      });
      const source = el('button', 'ps-source', 'ดูต้นทาง');
      source.type = 'button';
      source.title = 'เปิดข้อมูลคนนี้บนเว็บสภาเภสัชกรรม';
      source.addEventListener('click', () => this.openSource(row.licenseNo));

      actions.append(button, source);
      card.append(actions);

      const meta = [row.status, row.expiry && `หมดอายุ ${row.expiry}`]
        .filter(Boolean)
        .join(' · ');
      if (meta) card.append(el('div', 'ps-meta', meta));
      // `warning` comes from the colour the council used — see src/pharmacist.js.
      for (const note of row.notes) {
        card.append(
          el('div', note.warning ? 'ps-note-row' : 'ps-note-plain', note.text)
        );
      }
      return card;
    }
  }

  if (!customElements.get('pharmacist-search')) {
    customElements.define('pharmacist-search', PharmacistSearch);
  }
})();
