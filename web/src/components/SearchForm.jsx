/**
 * Administrative data is static, so all three levels are selectable before any
 * search has run. Counts from the latest search are layered on top when they
 * exist, so the officer can see which areas actually have shops.
 */
function options(names, facet) {
  const counts = new Map((facet || []).map((f) => [f.name, f.count]));
  return names.map((name) => {
    const count = counts.get(name);
    return { value: name, label: count ? `${name} (${count})` : name };
  });
}

function Select({ label, value, names, facet, placeholder, onChange }) {
  const list = options(names, facet);
  return (
    <select
      aria-label={label}
      value={list.some((o) => o.value === value) ? value : ''}
      disabled={list.length === 0}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {list.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default function SearchForm({
  areas,
  facets,
  query,
  busy,
  onQueryChange,
  onSubmit,
}) {
  const districts = areas[query.province] || {};
  const subdistricts = districts[query.district] || [];

  return (
    <form
      className="glass-panel"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input
        id="search-keyword"
        type="text"
        placeholder="ชื่อร้านยา เช่น ฟาร์มาซี…"
        autoComplete="off"
        required
        value={query.keyword}
        onChange={(event) => onQueryChange({ keyword: event.target.value })}
      />
      <button className="primary" type="submit" disabled={busy}>
        ค้นหา
      </button>

      <div className="filters">
        <Select
          label="จังหวัด"
          placeholder="ทุกจังหวัด"
          value={query.province}
          names={Object.keys(areas)}
          facet={facets?.provinces}
          // Narrowing a level clears the levels below it.
          onChange={(province) =>
            onQueryChange({ province, district: '', subdistrict: '' }, true)
          }
        />
        <Select
          label="อำเภอ / เขต"
          placeholder="ทุกอำเภอ / เขต"
          value={query.district}
          names={Object.keys(districts)}
          facet={facets?.districts}
          onChange={(district) => onQueryChange({ district, subdistrict: '' }, true)}
        />
        <Select
          label="ตำบล / แขวง"
          placeholder="ทุกตำบล / แขวง"
          value={query.subdistrict}
          names={subdistricts}
          facet={facets?.subdistricts}
          onChange={(subdistrict) => onQueryChange({ subdistrict }, true)}
        />
      </div>
    </form>
  );
}
