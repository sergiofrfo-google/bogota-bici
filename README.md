# Bogotá Bici

Planeador de rutas en bici para Bogotá, gratis y comunitario.

- Elige origen y destino y compara la ruta **más rápida** con la de **más ciclorruta**.
- Cada tramo se marca como ciclorruta exclusiva, compartida con peatones, carril pintado o con carros.
- Reporta huecos, cierres, conexiones faltantes, cruces peligrosos y zonas de robo, y confirma si "sigue ahí" o "ya está arreglado".
- Capas: red oficial de ciclorrutas (IDU), talleres y bombas de aire.

## How it works

A static site: no build step, no server, no API keys. Open `index.html` through any static host (GitHub Pages).

| Need | Free service |
|---|---|
| Routing and path types | [BRouter](https://brouter.de) (`safety` and `fastbike` profiles, OSM way tags) |
| Base map | OpenFreeMap, falling back to OpenStreetMap raster tiles |
| Place search | Photon and Nominatim |
| Official ciclorruta network | IDU via IDECA map server (CC BY 4.0) |
| Bike shops and pumps | OpenStreetMap via Overpass |

Reports are stored only in the browser (localStorage) for now. `supabase/schema.sql` is the planned shared backend.

Open a route directly with `?a=lat,lng&b=lat,lng&an=Name&bn=Name`.

Map data © OpenStreetMap contributors.
