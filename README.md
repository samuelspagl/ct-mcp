# ChurchTools MCP Server

TypeScript Streamable HTTP MCP server for ChurchTools. It exposes dedicated tools for common ChurchTools reads and updates, plus OpenAPI-backed generic search/execute tools for the long tail of the ChurchTools REST API.

## Configuration

The server supports two authentication modes.

- `CHURCHTOOLS_BASE_URL`: ChurchTools base URL, for example `https://example.church.tools`.

### PAT Mode

- `CHURCHTOOLS_AUTH_MODE=pat`
- `CHURCHTOOLS_PAT`: ChurchTools login/API token. The server forwards it as `Authorization: Login <token>`.
- `MCP_SERVER_TOKEN`: bearer token required by callers of `POST /mcp`.

`MCP_SERVER_TOKEN` is required unless `ALLOW_UNAUTHENTICATED_MCP=true` is set.

### OAuth Mode

- `CHURCHTOOLS_AUTH_MODE=oauth`
- `PUBLIC_BASE_URL`: externally reachable server URL, for example `https://mcp.example.org`.
- `MCP_TOKEN_SIGNING_SECRET`: at least 32 random characters. Used to HMAC-hash server-issued MCP token material at rest.
- `TOKEN_ENCRYPTION_KEY`: at least 32 random characters. Used to encrypt stored ChurchTools access/refresh tokens.
- `CHURCHTOOLS_OAUTH_CLIENT_ID`
- `CHURCHTOOLS_OAUTH_CLIENT_SECRET`
- `CHURCHTOOLS_OAUTH_AUTHORIZE_URL`
- `CHURCHTOOLS_OAUTH_TOKEN_URL`
- `CHURCHTOOLS_OAUTH_PROFILE_URL`: optional; defaults to `${CHURCHTOOLS_BASE_URL}/oauth/userinfo`.
- `CHURCHTOOLS_OAUTH_SCOPE`: optional ChurchTools OAuth scope string.
- `OAUTH_TOKEN_STORE_PATH`: optional; defaults to `./data/tokens.db` for local development. For persistent Docker deployments, set this to `/data/tokens.db`.
- `MCP_ACCESS_TOKEN_TTL_SECONDS`: optional; defaults to `900`.
- `MCP_REFRESH_TOKEN_TTL_SECONDS`: optional; defaults to `2592000`.

Configure the ChurchTools OAuth redirect URI exactly as:

```text
${PUBLIC_BASE_URL}/oauth/churchtools/callback
```

Use the Authorization URL, Token URL, Profile URL, and Client ID shown in the ChurchTools OAuth client settings. For current ChurchTools systems these usually look like:

```bash
CHURCHTOOLS_OAUTH_AUTHORIZE_URL=https://your-domain.church.tools/oauth/authorize
CHURCHTOOLS_OAUTH_TOKEN_URL=https://your-domain.church.tools/oauth/access_token
CHURCHTOOLS_OAUTH_PROFILE_URL=https://your-domain.church.tools/oauth/userinfo
```

In OAuth mode the MCP server is both the protected resource and authorization server for MCP clients. It redirects users to ChurchTools using the authorization-code flow, stores the resulting ChurchTools OAuth tokens encrypted per user, and issues its own short-lived MCP access tokens to MCP clients. ChurchTools OAuth tokens are used for OAuth endpoints such as `/oauth/userinfo`; this ChurchTools REST API does not accept them as `/api` bearer tokens. For REST API tools, use PAT mode or add a separate per-user ChurchTools Login token flow.

Optional shared settings:

- `ALLOW_UNAUTHENTICATED_MCP=true`: disables inbound MCP bearer-token checks in PAT mode only.
- `CHURCHTOOLS_OPENAPI_URL`: defaults to `${CHURCHTOOLS_BASE_URL}/system/runtime/swagger/openapi.json`.
- `PORT`, `HOST`, `LOG_LEVEL`, `REQUEST_TIMEOUT_MS`, `MAX_RESPONSE_BYTES`.

## Security Notes

In OAuth mode this server stores ChurchTools access and refresh tokens for all authorized users of this MCP instance. Treat the server, `.env` secrets, token database, and Docker volume as trusted infrastructure for exactly one ChurchTools instance or congregation.

Protect these especially:

- `.env` and deployment secrets.
- `TOKEN_ENCRYPTION_KEY`; if it is lost, existing stored ChurchTools tokens cannot be decrypted.
- `./data/tokens.db`, `/data/tokens.db`, or the configured `OAUTH_TOKEN_STORE_PATH`.
- The Docker volume mounted at `/data`.

Use HTTPS for production `PUBLIC_BASE_URL` values. Localhost is only suitable for development. Do not log tokens or return them from tools. If you rotate secrets, expect users to re-authorize unless you migrate or preserve decryptable token material.

OAuth endpoints exposed by this server:

- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server`
- `/authorize`
- `/token`
- `/register`
- `/revoke`
- `/oauth/churchtools/callback`
- `/oauth/disconnect`

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Edit `.env` before starting the server. At minimum, set:

```bash
CHURCHTOOLS_BASE_URL=https://your-domain.church.tools
CHURCHTOOLS_AUTH_MODE=pat
CHURCHTOOLS_PAT=your-churchtools-login-token
MCP_SERVER_TOKEN=choose-a-token-for-mcp-clients
```

Node.js `>=22.5.0` is required because OAuth mode uses the built-in SQLite driver for the token store.

With Bun, `bun run dev` loads `.env` automatically. With npm/tsx, export the variables in your shell or use your preferred `.env` loader.
The server also loads `.env` during startup, so `npm run dev`, `bun run dev`, and `npm start` all work from the project root once `.env` exists.

The HTTP endpoints are:

- `POST /mcp`: MCP Streamable HTTP endpoint.
- `GET /health`: liveness.
- `GET /ready`: confirms the OpenAPI catalog is loaded.

## Tools

Dedicated read tools include current user, persons, person groups/events, groups, group members, events, event agenda, calendars, appointments, resources, bookings, songs, and wiki pages/categories. In OAuth mode, `churchtools_whoami` returns the stored `/oauth/userinfo` profile; the other REST API tools require PAT mode until a per-user ChurchTools Login token flow is added.

Dedicated write tools:

- `churchtools_update_song`
- `churchtools_update_event`
- `churchtools_update_wiki_category`

All write tools use MCP elicitation for confirmation when supported. If the client does not advertise elicitation support, the tool returns `confirmation_required`; retry the same tool with `confirm=true` after user confirmation.

Generic OpenAPI tools:

- `churchtools_search_actions`
- `churchtools_execute_read_action`
- `churchtools_execute_write_action`

## Docker

```bash
docker build -t churchtools-mcp-server .
docker run --rm -p 3000:3000 --env-file .env churchtools-mcp-server
```

For OAuth mode, set `OAUTH_TOKEN_STORE_PATH=/data/tokens.db` and mount a persistent `/data` volume:

```bash
docker run --rm -p 3000:3000 --env-file .env -e OAUTH_TOKEN_STORE_PATH=/data/tokens.db -v churchtools-mcp-data:/data churchtools-mcp-server
```

Or use `docker-compose.example.yml` as a starting point.
