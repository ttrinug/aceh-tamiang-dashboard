// Bar charts for the chart panels, drawn with Chart.js (loaded in index.html as window.Chart).
// Horizontal bars, sorted largest first. With one series, the selected kecamatan gets a darker
// bar; it always gets a bold "▸" label, so the highlight never relies on colour alone.

const BAR = '#4f8fd6';
const SELECTED = '#123f7c';

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// What each canvas currently shows. The chart's callbacks read from here, so a redraw only
// changes data and this record. Chart.js objects are never replaced or destroyed during a
// redraw, because a click on a bar triggers the redraw from inside Chart.js's own handler.
const views = new WeakMap();

function createChart(canvas) {
  const view = () => views.get(canvas);
  return new Chart(canvas, {
    type: 'bar',
    data: { labels: [], datasets: [] },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          position: 'top',
          align: 'start',
          labels: { color: token('--text'), boxWidth: 12, boxHeight: 12, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (item) => {
              const value = `${view().format(item.raw)} ${view().unit}`;
              return view().series.length > 1 ? `${item.dataset.label}: ${value}` : value;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: token('--border') },
          border: { display: false },
          ticks: { color: token('--muted'), font: { size: 11 } },
          title: { display: true, color: token('--muted'), font: { size: 11 } }
        },
        y: {
          grid: { display: false },
          ticks: {
            autoSkip: false,
            color: token('--text'),
            font: (context) => ({ size: 11, weight: context.index === view().selectedIndex ? '700' : '400' }),
            callback: (value, index) => {
              const name = view().rows[index].name;
              return index === view().selectedIndex ? `▸ ${name}` : name;
            }
          }
        }
      },
      onClick: (event, elements) => {
        if (elements.length && view().onSelect) view().onSelect(view().rows[elements[0].index].id);
      },
      onHover: (event, elements) => {
        event.native.target.style.cursor = elements.length && view().onSelect ? 'pointer' : 'default';
      }
    }
  });
}

// rows:   [{ id, name, values: [one number per series], color? }]
// series: [{ label, color? }]. More than one series draws stacked bars with a legend.
// A row's own color (for example a land cover class) overrides the series colour.
// onSelect(id) is called when a bar is clicked; leave it out when bars are not kecamatan.
export function drawBarChart({ canvas, rows, series, selectedId = null, locale, unit, digits, onSelect = null }) {
  const total = (row) => row.values.reduce((sum, value) => sum + value, 0);
  const sorted = [...rows].sort((a, b) => total(b) - total(a));
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const stacked = series.length > 1;
  views.set(canvas, {
    rows: sorted,
    series,
    selectedIndex: sorted.findIndex((row) => row.id === selectedId),
    unit,
    format: (value) => number.format(value),
    onSelect
  });

  const chart = Chart.getChart(canvas) ?? createChart(canvas);
  chart.data.labels = sorted.map((row) => row.name);
  chart.data.datasets = series.map((s, index) => ({
    label: s.label,
    data: sorted.map((row) => row.values[index]),
    backgroundColor: sorted.map((row) => row.color ?? s.color ?? (row.id === selectedId ? SELECTED : BAR)),
    borderColor: token('--surface'),
    borderWidth: stacked ? { right: 1 } : 0,
    borderRadius: stacked ? 0 : 4,
    borderSkipped: 'start',
    barPercentage: 0.75,
    categoryPercentage: 0.9
  }));
  chart.options.locale = locale;
  chart.options.plugins.legend.display = stacked;
  chart.options.scales.x.stacked = stacked;
  chart.options.scales.y.stacked = stacked;
  chart.options.scales.x.title.text = unit;
  chart.update('none');
}

// Removes the chart when the selected parameter has no data to draw.
export function clearChart(canvas) {
  Chart.getChart(canvas)?.destroy();
  views.delete(canvas);
}
