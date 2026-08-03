# LINE OA Demo With Cloudflare Tunnel

This guide prepares the local backend for a real LINE OA demo through
Cloudflare Tunnel.

## Environment

Set these values in `.env`.

```env
LINE_CHANNEL_ACCESS_TOKEN=<LINE OA channel access token>
LINE_CHANNEL_SECRET=<LINE OA channel secret>
```

LINE delivery always uses the real LINE Messaging API. If
`LINE_CHANNEL_ACCESS_TOKEN` is missing, the LINE delivery job fails and records
the error in message delivery logs.

## Quick Tunnel

Use this for local demo/testing. Cloudflare will print a random
`https://*.trycloudflare.com` URL in the logs.
The Docker service forces HTTP/2 transport so it also works on networks where
outbound QUIC/UDP is blocked.

```bash
npm run docker:up
npm run docker:tunnel:quick
```

Set the LINE webhook URL to:

```text
https://<printed-trycloudflare-domain>/api/line/webhook
```

Then enable webhook usage in LINE Developers and run webhook verification.

Quick Tunnels are intended for development/testing and the URL changes when the
tunnel is recreated. For a stable demo URL, use a named tunnel.

## Named Tunnel

Create a tunnel in Cloudflare Zero Trust, configure a public hostname, and route
it to the Docker API service:

```text
http://api:8080
```

Copy the generated tunnel token into `.env`.

```env
CLOUDFLARE_TUNNEL_TOKEN=<cloudflare tunnel token>
```

Start the named tunnel.

```bash
npm run docker:tunnel
```

Set the LINE webhook URL to:

```text
https://<your-cloudflare-hostname>/api/line/webhook
```

## Vendor LINE Flow

1. Gate creates a ticket through `POST /api/gate/tickets`.
2. Backend finds active LINE targets from the synced stall owner/member tables
   by `MarketCode + BoothCode`.
3. Backend pushes a Gate-created summary to every owner/member target for that
   booth.
4. Worker submits quantities through
   `POST /api/workers/me/assignments/{TicketNo}/tickets/{BoothCode}/complete`.
5. Backend pushes a worker-submitted summary and a `Confirm`/`Reject` buttons
   template to every owner/member target for that booth.
6. LINE sends a signed webhook postback to `/api/line/webhook` with
   `token=<signed-token>`.
7. Backend verifies `x-line-signature` with `LINE_CHANNEL_SECRET`, checks that
   the LINE user is mapped to the booth, and updates the ticket status.
8. If the vendor confirms, backend sends a 1-5 rating prompt to the confirming
   LINE user.
9. Rating buttons send `token=<signed-token>&score=<1-5>` to
   `/api/line/webhook`; backend stores one rating per ticket and LINE user.

The LINE user must be able to receive push messages from the OA, usually by
adding the OA as a friend or otherwise being in a valid messaging relationship.

## References

- Cloudflare Quick Tunnels:
  https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- Cloudflare Tunnel with Docker:
  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/deploy-tunnels/deployment-guides/docker/
- LINE webhook signature:
  https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
- LINE Messaging API push messages:
  https://developers.line.biz/en/reference/messaging-api/nojs/#send-push-message
