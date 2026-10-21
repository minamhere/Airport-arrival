# Flight Departure Planner

Works backwards from a takeoff time to a "leave home by" time. Supports any departure airport, drive-time estimates from an address or current location, and multiple saved trips that sync across devices.

## Layout

```
public/index.html            The app (single file, vanilla JS, no build step)
functions/api/[[path]].js    Sync API (Cloudflare Pages Function)
schema.sql                   D1 table (also auto-created on first request)
wrangler.toml                Pages + D1 binding config
```

## Features

- **Airport picker**: built-in list of ~60 US airports, plus a worldwide search (OpenStreetMap) for any other airport.
- **Starting address and drive estimate**: a compact row shows the selected address and drive minutes. Search/Change opens an address panel with a current-location button inside the search field; picking an address closes it. Online results prefer the airport area and are sorted by distance to the airport, while addresses farther away remain searchable. Saved places filter locally as you type. Routing comes from the public OSRM server, which has no live traffic data. Estimates are rounded up to 5 minutes, with no automatic traffic buffer. Add extra time with the drive bar as needed. The address panel also lets you refresh or re-apply the route estimate.
- **Bars**: every segment goes to 0. Each bar has −/+ buttons (hold to repeat), tap-to-jump and horizontal drag on the track (vertical swipes still scroll the page), and tapping the value lets you type an exact number of minutes.
- **Airport stop**: Lounge or Straight to gate. Straight to gate hides the dwell time and second walk.
- **Presets**: the compact **Intl.** checkbox beside the trip name selects International; unchecked means Domestic and is the default for new trips. Switching it sets every segment except the drive, which depends on location.
- **Trips**: list of upcoming and past trips with leave-by times and countdowns; duplicate, delete, and copy the schedule as text. Each trip has a date, so overnight schedules show the correct day.
- **Sync**: trips and saved places are stored in Cloudflare D1 and are available on any browser signed in with the passphrase. Export and Import (JSON) serve as backup.

If the page is served without the API (plain static host or opened from disk), it runs in local-only mode with a warning, and data is lost when the page closes unless exported.

## Schedule logic

Working backwards from takeoff:

```
Takeoff
  − Boarding → takeoff         → Boarding starts
  − Walk to gate               → Leave lounge/restaurant      (skipped for Straight to gate)
  − Lounge / meal time         → Arrive lounge/restaurant     (skipped for Straight to gate)
  − Security → stop/gate walk  → Clear security
  − Security screening         → Enter security
  − Park & shuttle             → Parked / enter terminal
  − Drive                      → Leave home
```

| Preset | parking | security | walk to stop | stop | walk to gate | boarding → takeoff |
|---|---|---|---|---|---|---|
| Domestic | 10 | 15 | 10 | 45 | 5 | 40 |
| International | 10 | 15 | 10 | 90 | 20 | 40 |

## Deploy (Cloudflare Pages + D1)

Requires Node.js and a Cloudflare account (free tier is sufficient).

```bash
# 1. Create the database and copy the printed database_id into wrangler.toml
npx wrangler d1 create flight-planner

# 2. Create the Pages project
npx wrangler pages project create flight-planner --production-branch master

# 3. Set the sync passphrase (this is what you type on each device once)
openssl rand -base64 24
npx wrangler pages secret put SYNC_TOKEN --project-name flight-planner

# 4. Deploy
npx wrangler pages deploy
```

To deploy from GitHub instead, connect the repo in the Cloudflare dashboard (Workers & Pages → Create → Pages → Connect to Git), set the build output directory to `public` with no build command, then under the project's Settings add the D1 binding `DB` and the secret `SYNC_TOKEN`.

On each device: open the site, enter the passphrase once (the session cookie lasts a year), then in Safari use Share → Add to Home Screen. Home screen apps on iOS keep their own cookies, so sign in again after adding it.

### Local development

```bash
echo 'SYNC_TOKEN=dev-passphrase' > .dev.vars
npx wrangler pages dev        # http://localhost:8788, local D1
```

Run the address-search regression tests with `node --test tests/*.test.cjs` (no test dependencies required).

## Security notes

- One passphrase protects all data. The cookie stores an HMAC derived from it, is `HttpOnly; Secure; SameSite=Strict`, and writes require `application/json`, which blocks cross-site form posts.
- Failed logins are delayed 750 ms. There is no lockout, so use a long random passphrase (step 3). Rotating `SYNC_TOKEN` signs out every device.
- Address searches and routing requests go from the browser to `nominatim.openstreetmap.org` and `router.project-osrm.org`. Both are free public services with fair-use limits; this app makes requests only on explicit user action. The public [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) prohibits online autocomplete and limits the application to one request per second. Geocoder calls are serialized and spaced in each browser, and repeated address searches use a small in-memory cache. This remains suitable only for light personal use; multiple users' combined requests count toward the service limit. Only saved-place suggestions update as you type, without network requests.

## Swapping the routing provider

`GEOCODER` and `ROUTER` are constants at the top of the script in `public/index.html`. For traffic-aware times, replace `estimateDrive()` with a call to Google Routes or Mapbox Directions (both need an API key, which should be proxied through a Pages Function rather than embedded in the page).
