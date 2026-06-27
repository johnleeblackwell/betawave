// Must be imported as the very first statement in the server entry point.
// ESM hoists `import` declarations, so calling dotenv.config() inline in
// index.ts runs AFTER every imported module has already evaluated — by which
// point db.ts and the route/service modules would have read process.env
// (DATABASE_PATH, API keys, APP_PASSWORD, etc.) as undefined. Putting the
// side-effect in its own module ensures the .env file is loaded before any
// subsequent import (db.ts, routes, services) is evaluated.
import { config } from 'dotenv'
config({ override: true })
