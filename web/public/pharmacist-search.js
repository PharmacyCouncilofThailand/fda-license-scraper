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
    }

    disconnectedCallback() {
      if (this.controller) this.controller.abort();
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

      const submit = el('button', 'ps-submit', 'ค้นหา');
      submit.type = 'submit';

      const row = el('div', 'ps-row');
      row.append(this.last, submit);
      form.append(el('span', 'ps-title', 'ค้นเลข ภ.'), this.first, row);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.search();
      });

      this.output = el('div', 'ps-output');
      this.append(form, this.output);
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
        this.show(data);
      } catch (err) {
        if (err.name === 'AbortError') return;
        this.say(err.message, 'ps-error');
      }
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

    card(row) {
      const card = el('div', 'ps-card');
      card.append(el('div', 'ps-name', row.fullName));

      const licence = el('div', 'ps-licence');
      licence.append(el('b', null, `ภ. ${row.licenseNo}`));

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
      licence.append(button);
      card.append(licence);

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
