# Fahrzeit

Travel time by public transport across Switzerland. The map starts at Pfingstweidstrasse 110, Zürich.

The published site is [lmaag182.github.io/fahrzeit](https://lmaag182.github.io/fahrzeit/).

To run it locally:

```bash
python3 -m http.server 8755
```

Then open http://127.0.0.1:8755/

Timetable data comes from [Transitous](https://transitous.org/sources/). Place names use OpenStreetMap. The base map is © swisstopo. MapLibre GL JS is included under its BSD license.
