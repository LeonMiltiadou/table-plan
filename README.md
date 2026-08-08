# Table Plan

A small seating-plan editor. Drag tables around a floor plan, drag guests between
chairs, and export the result as a picture or a spreadsheet.

No build step, no server, no dependencies — three static files and a data file.

## Using it

| To do this | Do that |
| --- | --- |
| Swap two people | Drag one name onto another |
| Move a table | Drag the table itself |
| Seat someone | Click their name under **Unseated**, then click an empty chair |
| Take someone off a table | Click their name on the plan, then **Unseat** |
| Add or remove chairs | Click a table, then drag the slider or type a number (max 3 per side) |
| Move around the plan | Drag the empty background |
| Zoom | Scroll, or the **−** / **+** buttons; click the percentage to fit everything |
| Hide the side panel | **Panel** |
| Undo | **Undo**, or Ctrl/Cmd+Z |

Changes save in the browser as you go. Nothing is sent anywhere — there is no
server and no account.

### Tables

Two shapes:

- **Diamond** — chairs on four runs, up to three per run, so 0–12 chairs.
- **Long table** — chairs along one side, 1–14 of them.

Both can be rotated. Every number — chairs per side, chair count, angle — has a
slider and a number box side by side; use whichever suits, they stay in step.

### Saving and sharing

**Save & share** offers four things:

- **Picture (.png)** — for printing, or sending to the venue
- **Guest list (.csv)** — opens in Excel or Google Sheets
- **Backup file (.json)** — the whole plan, including where the tables are. Reopen
  it later with **Open backup**, or on another computer
- **Picture (.svg)** — same picture, stays sharp at any size

Because the plan lives in your own browser, changes made on your laptop do not
appear on someone else's. To hand a plan over, export the backup file and let
them open it.

## Running it locally

Any static file server will do:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight from disk works too.

## Your own guest list

The app opens with a small **example plan made of invented names**. Real guest
lists are personal data, so none ship with this repo and none are deployed.

To use your own:

1. Build your plan in the app, or start from the example.
2. **Save & share → Backup file (.json)**, and keep that file somewhere private.
3. Anyone who needs it — you on another machine, or whoever is helping — opens the
   app and clicks **Open backup**, then picks that file.

Once opened, the plan stays in that browser, so it only has to be done once.

The example plan itself is generated:

```sh
node tools/build-plan-data.mjs
```

Guests are listed in chair order, clockwise from the top corner of each table.

## Files

```
index.html   markup
app.css      page styling
app.js       the whole app — geometry, dragging, import/export
plan-data.js generated starting plan
tools/       the generator for plan-data.js
```

The plan's own styling lives in `app.js` rather than the stylesheet, so exported
pictures carry their styles with them and look right anywhere.

## Deploying

Any static host works. This copy runs on GitHub Pages from `main`.

Assets are loaded with a `?v=N` query string. **Bump that number in
`index.html` whenever you change `app.js`, `app.css` or `plan-data.js`** —
hosts cache those files for minutes, and a fresh page paired with a stale
script is a broken page.
