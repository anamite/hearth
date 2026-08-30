/**
 * A stack of blank 5x5 grids, for anyone who would rather play on paper.
 *
 * Deliberately not a dependency: it opens a plain print window the browser
 * renders and can save as a PDF. Nothing here is required to play — the
 * grid on the phone is the one that scores.
 */
export function printBlankGrids(count = 6): void {
  const win = window.open('', '_blank', 'width=820,height=1100');
  if (!win) return;

  const grid = `
    <table class="g">
      ${Array.from({ length: 5 }, () => `<tr>${'<td></td>'.repeat(5)}</tr>`).join('')}
    </table>`;

  const card = `
    <div class="card">
      <div class="name"><span>Name</span><i></i></div>
      ${grid}
      <div class="score"><span>Score</span><i></i></div>
    </div>`;

  win.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Grid — blank sheets</title>
    <style>
      @page { margin: 14mm; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        color: #111;
      }
      h1 { font-size: 15pt; margin: 0 0 2mm; }
      p.rule { font-size: 9pt; margin: 0 0 6mm; color: #555; }
      .sheet { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
      .card { break-inside: avoid; }
      .name, .score {
        display: flex; align-items: flex-end; gap: 3mm;
        font-size: 8pt; text-transform: uppercase; letter-spacing: .12em; color: #555;
      }
      .name { margin-bottom: 2mm; }
      .score { margin-top: 2mm; }
      .name i, .score i { flex: 1; border-bottom: 1px solid #999; height: 4mm; }
      table.g { border-collapse: collapse; width: 100%; }
      table.g td {
        border: 1.2pt solid #111;
        width: 20%; height: 0; padding-bottom: 20%;
      }
    </style>
  </head>
  <body>
    <h1>Grid</h1>
    <p class="rule">
      Twenty-five cards, one number each into any empty square. No skipping,
      no moving it later. Score every row and column: a run of 2 is 1 point,
      3 is 3, 4 is 6, 5 is 10.
    </p>
    <div class="sheet">${card.repeat(Math.max(1, Math.min(24, count)))}</div>
    <script>window.onload = function () { window.print(); };<\/script>
  </body>
</html>`);
  win.document.close();
}
