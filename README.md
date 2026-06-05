# ChurchTools MCP Server

TypeScript Streamable HTTP MCP server for ChurchTools. It exposes dedicated tools for common ChurchTools reads and updates, plus OpenAPI-backed generic search/execute tools for the long tail of the ChurchTools REST API.

![ChurchTools MCP demo](docs/screenshots/ct-mcp.gif)

## Configuration

Common environment variables:

- `CHURCHTOOLS_BASE_URL`: ChurchTools base URL, for example `https://example.church.tools`.
- `CHURCHTOOLS_AUTH_MODE`: `pat` or `pat-forwarding`.
- `MCP_SERVER_TOKEN`: bearer token required by callers of `POST /mcp`.

### PAT Mode

- `CHURCHTOOLS_AUTH_MODE=pat`
- `CHURCHTOOLS_PAT`: ChurchTools login/API token. The server forwards it as `Authorization: Login <token>`.

This mode uses one configured ChurchTools token for all MCP callers.

### PAT Forwarding Mode

- `CHURCHTOOLS_AUTH_MODE=pat-forwarding`
- Do not set `CHURCHTOOLS_PAT`.
- Every `POST /mcp` request must include the user's ChurchTools PAT in `X-ChurchTools-PAT`.

The server does not store forwarded PATs. It reads the header for the current MCP request and forwards it upstream as `Authorization: Login <token>`. Keep `MCP_SERVER_TOKEN` enabled in this mode so the MCP endpoint itself still has an access control boundary.

Example MCP request headers:

```http
Authorization: Bearer <mcp-server-token>
X-ChurchTools-PAT: <user-churchtools-pat>
```

Optional:

- `ALLOW_UNAUTHENTICATED_MCP=true`: disables inbound MCP bearer-token checks.
- `CHURCHTOOLS_OPENAPI_URL`: defaults to `${CHURCHTOOLS_BASE_URL}/system/runtime/swagger/openapi.json`.
- `PORT`, `HOST`, `LOG_LEVEL`, `REQUEST_TIMEOUT_MS`, `MAX_RESPONSE_BYTES`.

OAuth is intentionally deferred. MCP token pass-through to ChurchTools is not spec-compliant, so a later OAuth implementation should use a proper MCP OAuth flow where this server obtains and validates tokens for itself.

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

For PAT forwarding, use:

```bash
CHURCHTOOLS_BASE_URL=https://your-domain.church.tools
CHURCHTOOLS_AUTH_MODE=pat-forwarding
MCP_SERVER_TOKEN=choose-a-token-for-mcp-clients
```

With Bun, `bun run dev` loads `.env` automatically. With npm/tsx, export the variables in your shell or use your preferred `.env` loader.
The server also loads `.env` during startup, so `npm run dev`, `bun run dev`, and `npm start` all work from the project root once `.env` exists.

The HTTP endpoints are:

- `POST /mcp`: MCP Streamable HTTP endpoint.
- `GET /health`: liveness.
- `GET /ready`: confirms the OpenAPI catalog is loaded.

## Tools

Dedicated `ct_*` tools cover current user context, people, groups, events, calendars, resources, bookings, absences, service requests, songs, wiki search/read, and masterdata. The server intentionally exposes only the `ct_*` namespace so clients do not see duplicate `ct_*` and `churchtools_*` variants of the same workflows.

Event tools use explicit scope:

- `ct_list_events` and `ct_get_event_briefing` are general visible-event tools and do not imply that a person is involved.
- `ct_list_my_involved_events`, `ct_list_person_involved_events`, and `ct_get_my_involved_event_briefing` use `/persons/{personId}/events`, meaning ChurchTools marks the person as involved in those events.
- `ct_list_my_service_requests` is the primary tool for concrete assigned tasks/service requests; those are separate from involved events.

Dedicated write tools:

- `ct_update_song`
- `ct_update_event`
- `ct_update_wiki_category`

All write tools use MCP elicitation for confirmation when supported. If the client does not advertise elicitation support, the tool returns `confirmation_required`; retry the same tool with `confirm=true` after user confirmation.

Generic OpenAPI tools:

- `ct_search_actions`
- `ct_execute_read_action`
- `ct_execute_write_action`

## Docker

```bash
docker build -t churchtools-mcp-server .
docker run --rm -p 3000:3000 --env-file .env churchtools-mcp-server
```

Or use `docker-compose.example.yml` as a starting point to run the published `ghcr.io/samuelspagl/ct-mcp:latest` image:

```bash
docker compose -f docker-compose.example.yml up
```

## GitHub Actions

Pull requests run version gating, secret scanning with Gitleaks, Node typecheck/test/build, and a Docker image build without pushing. The version gate requires `VERSION`, `package.json`, and `package-lock.json` to contain the same SemVer value. Pull requests fail if the version was not changed from `main` or if tag `v<VERSION>` already exists.

Every push to `main` creates tag `v<VERSION>` and a GitHub release. The release includes the npm build output archive from `dist/`, plus package metadata and the `VERSION` file. The same workflow builds and pushes Docker images to GitHub Container Registry:

```text
ghcr.io/<owner>/<repo>:latest
ghcr.io/<owner>/<repo>:v<VERSION>
```

Before merging a release-bound pull request, update all three version locations:

```text
VERSION
package.json
package-lock.json
```
